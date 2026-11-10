import type { H3Event } from 'h3'
import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { classPasses, classPassHoldings } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { resolveStringSetting } from './settings'
import { resolveStripeProvider } from './payments/resolve'
import { refundPayment, withPendingOrder } from './orders'
import { toMinorUnits } from '../../shared/lib/money'
import { normalizeEmail } from './mailing-list'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'
import { requireSiteId } from './site-context'
import { sendTemplatedEmail } from './email-template'

/**
 * Class passes: a block of sessions bought in one go. A holding belongs to an email address
 * and not an account, because visitors buy without signing up. So spending a credit always
 * needs proof of the address, through a link sent to it; typing an address is never enough.
 */

export type ClassPassRow = typeof classPasses.$inferSelect
export type HoldingRow = typeof classPassHoldings.$inferSelect

/** How long a link to someone's bookings and passes works. */
const ACCESS_LINK_DAYS = 7

/**
 * Whether a site can take card payments for bookings. The webhook secret counts: without
 * it a visitor could pay and never get the place, so checkout isn't offered at all.
 */
export async function bookingPaymentsReady(event: H3Event): Promise<boolean> {
  const [key, secret] = await Promise.all([
    resolveStringSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey'),
    resolveStringSetting(event, 'payments.stripe_webhook_secret', 'stripeWebhookSecret'),
  ])
  return Boolean(key && secret)
}

/** Where a system email's links point: a cron run has no request to take the address from. */
export function bookingOrigin(event: H3Event): string {
  return event.context.publicOrigin ?? getRequestURL(event).origin
}

// ── Credits ─────────────────────────────────────────────────────────────────

export function creditsLeft(holding: Pick<HoldingRow, 'creditsTotal' | 'creditsUsed'>): number {
  return Math.max(0, holding.creditsTotal - holding.creditsUsed)
}

/**
 * Takes credits from one of an address's passes, the one expiring soonest first. A pass has
 * to still be valid when the class happens, not just today. All from one pass: splitting a
 * booking across two would make giving them back a lot harder for little gain. Null when no
 * pass has enough. The update's own condition stops two bookings spending the same credit.
 */
export async function spendCredits(db: Db, siteId: string, email: string, credits: number, startsAt: string | null): Promise<string | null> {
  const address = normalizeEmail(email)
  const valid = startsAt
    ? or(isNull(classPassHoldings.expiresAt), gte(classPassHoldings.expiresAt, startsAt))
    : undefined
  const holdings = await db.query.classPassHoldings.findMany({
    where: and(eq(classPassHoldings.siteId, siteId), eq(classPassHoldings.email, address), eq(classPassHoldings.status, 'active'), valid),
    // Nulls (never expires) last, so credits that can run out are used first.
    orderBy: [sql`${classPassHoldings.expiresAt} is null`, asc(classPassHoldings.expiresAt), asc(classPassHoldings.createdAt)],
    limit: 50,
  })
  for (const holding of holdings) {
    if (creditsLeft(holding) < credits) continue
    const [taken] = await db.update(classPassHoldings)
      .set({ creditsUsed: sql`${classPassHoldings.creditsUsed} + ${credits}`, updatedAt: new Date().toISOString() })
      .where(and(
        eq(classPassHoldings.id, holding.id),
        eq(classPassHoldings.siteId, siteId),
        eq(classPassHoldings.status, 'active'),
        sql`${classPassHoldings.creditsTotal} - ${classPassHoldings.creditsUsed} >= ${credits}`,
      ))
      .returning({ id: classPassHoldings.id })
    if (taken) return taken.id
  }
  return null
}

export async function returnCredits(db: Db, siteId: string, holdingId: string, credits: number): Promise<void> {
  await db.update(classPassHoldings)
    .set({ creditsUsed: sql`max(0, ${classPassHoldings.creditsUsed} - ${credits})`, updatedAt: new Date().toISOString() })
    .where(and(eq(classPassHoldings.id, holdingId), eq(classPassHoldings.siteId, siteId)))
}

// ── Buying ──────────────────────────────────────────────────────────────────

export interface PassBuyer {
  email: string
  name: string
}

/** Sends a visitor to Stripe for a pass. The holding is only made when the payment arrives. */
export async function createPassCheckout(event: H3Event, pass: ClassPassRow, buyer: PassBuyer): Promise<string> {
  const siteId = requireSiteId(event)
  const stripe = await resolveStripeProvider(event)
  if (!stripe || !(await bookingPaymentsReady(event))) httpError({ status: 503, message: 'Online payments aren\'t available right now.' })
  const origin = bookingOrigin(event)
  const email = normalizeEmail(buyer.email)
  let url: string | null
  try {
    const description = `${pass.credits} ${pass.credits === 1 ? 'session' : 'sessions'}`
    const order = {
      email,
      name: buyer.name,
      currency: pass.currency,
      lines: [{ kind: 'pass' as const, refId: pass.id, name: pass.name, description, quantity: 1, unitMinor: toMinorUnits(pass.price, pass.currency) }],
    }
    const session = await withPendingOrder(event, order, ({ id: orderId }) => stripe.createPaymentCheckout({
      customerEmail: email,
      item: {
        name: pass.name,
        description,
        amount: pass.price,
        currency: pass.currency,
        quantity: 1,
      },
      successUrl: `${origin}/booking/thanks?type=pass`,
      cancelUrl: `${origin}/booking/passes`,
      metadata: { nuxflowKind: 'pass', siteId, passId: pass.id, email, name: buyer.name.slice(0, 100), orderId },
    }))
    url = session.url
  }
  catch (err) {
    console.error('[class-passes] Checkout failed:', err)
    httpError({ status: 502, message: 'We couldn\'t reach the payment provider. Please try again in a few minutes.' })
  }
  if (!url) httpError({ status: 502, message: 'We couldn\'t reach the payment provider. Please try again in a few minutes.' })
  return url
}

function expiryFrom(validDays: number | null, now: Date = new Date()): string | null {
  return validDays ? new Date(now.getTime() + validDays * 86_400_000).toISOString() : null
}

/**
 * Records a paid pass. Safe to call for the same session twice: the unique index keeps one
 * holding per session, and the return value says whether this call made it. The price and
 * credits come from the pass row, except the amount, which is what Stripe actually took.
 */
export async function recordPassPurchase(db: Db, siteId: string, input: {
  passId: string
  email: string
  name: string
  amountPaid: number
  currency: string
  sessionId: string
  paymentIntentId: string | null
}): Promise<{ holding: HoldingRow; created: boolean } | null> {
  const pass = await db.query.classPasses.findFirst({ where: and(eq(classPasses.id, input.passId), eq(classPasses.siteId, siteId)) })
  // Bought, then deleted before the webhook arrived. They've paid, so the caller refunds it.
  if (!pass) return null
  const [row] = await db.insert(classPassHoldings).values({
    id: ulid(),
    siteId,
    passId: pass.id,
    passName: pass.name,
    email: normalizeEmail(input.email),
    name: input.name,
    creditsTotal: pass.credits,
    expiresAt: expiryFrom(pass.validDays),
    amountPaid: input.amountPaid,
    currency: input.currency,
    stripeSessionId: input.sessionId,
    stripePaymentIntentId: input.paymentIntentId,
  }).onConflictDoNothing().returning()
  if (row) return { holding: row, created: true }
  const existing = await db.query.classPassHoldings.findFirst({
    where: and(eq(classPassHoldings.siteId, siteId), eq(classPassHoldings.stripeSessionId, input.sessionId)),
  })
  return existing ? { holding: existing, created: false } : null
}

/** A pass added by the team, such as one sold at the front desk. No money moves here. */
export async function grantPass(db: Db, siteId: string, pass: ClassPassRow, buyer: PassBuyer): Promise<HoldingRow> {
  const [row] = await db.insert(classPassHoldings).values({
    id: ulid(),
    siteId,
    passId: pass.id,
    passName: pass.name,
    email: normalizeEmail(buyer.email),
    name: buyer.name,
    creditsTotal: pass.credits,
    expiresAt: expiryFrom(pass.validDays),
    amountPaid: 0,
    currency: pass.currency,
  }).returning()
  return row!
}

/**
 * Refunds the credits nobody has used, at the share of the price they cost. What's already
 * been used stays paid for, and the pass can't be spent afterwards. A pass the team added by
 * hand has no payment behind it, so it's only closed.
 */
export async function refundUnusedCredits(event: H3Event, holding: HoldingRow): Promise<{ refunded: number }> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const left = creditsLeft(holding)
  if (holding.status !== 'active' || left === 0) conflict('This pass has no unused credits to refund.')

  const paidBack = Math.round(((holding.amountPaid - holding.amountRefunded) * left / holding.creditsTotal) * 100) / 100
  if (holding.stripePaymentIntentId && paidBack > 0) {
    try {
      await refundPayment(event, {
        paymentIntentId: holding.stripePaymentIntentId,
        amountMinor: toMinorUnits(paidBack, holding.currency),
        currency: holding.currency,
        idempotencyKey: `pass-refund-${holding.id}-${holding.creditsUsed}`,
        reason: 'Unused credits refunded',
      })
    }
    catch (err) {
      console.error('[class-passes] Refund failed:', err)
      httpError({ status: 502, message: err instanceof Error ? `Stripe refused the refund: ${err.message}` : 'Stripe refused the refund.' })
    }
  }
  await db.update(classPassHoldings)
    .set({
      status: 'refunded',
      amountRefunded: sql`${classPassHoldings.amountRefunded} + ${paidBack}`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(classPassHoldings.id, holding.id), eq(classPassHoldings.siteId, siteId)))
  return { refunded: holding.stripePaymentIntentId ? paidBack : 0 }
}

// ── A visitor's own bookings, without an account ────────────────────────────

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

export function bookingAccessToken(siteId: string, email: string, expires: number): Promise<string> {
  return hmacSha256Hex(linkSecret(), `booking-access:${siteId}:${email}:${expires}`)
}

export async function verifyBookingAccess(siteId: string, email: string, expires: number, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token) || !Number.isFinite(expires) || expires < Date.now()) return false
  return constantTimeEqualHex(await bookingAccessToken(siteId, normalizeEmail(email), expires), token)
}

export async function bookingAccessLink(event: H3Event, email: string): Promise<string> {
  const address = normalizeEmail(email)
  const expires = Date.now() + ACCESS_LINK_DAYS * 86_400_000
  const token = await bookingAccessToken(requireSiteId(event), address, expires)
  return `${bookingOrigin(event)}/booking/my?${new URLSearchParams({ email: address, expires: String(expires), token })}`
}

export async function sendPassPurchasedEmail(event: H3Event, holding: HoldingRow): Promise<void> {
  const validity = holding.expiresAt
    ? `Use them by ${new Date(holding.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`
    : 'They don\'t expire.'
  await sendTemplatedEmail(event, {
    to: holding.email,
    subject: `Your ${holding.passName}`,
    category: 'event_rsvp',
    template: {
      heading: 'Thanks, your pass is ready',
      paragraphs: [
        `You have ${holding.creditsTotal} ${holding.creditsTotal === 1 ? 'session' : 'sessions'} on your ${holding.passName}. ${validity}`,
        `To book, choose "Use my pass" on a class and enter this email address. We'll send a link to confirm each booking, so nobody else can use your sessions.`,
      ],
      action: { label: 'See my bookings and passes', url: await bookingAccessLink(event, holding.email) },
    },
  })
}
