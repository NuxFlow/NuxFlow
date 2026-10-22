import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { mailingListSubscribers } from '@nuxflow/db/schema'
import { useDb } from './db'
import { resolveSetting } from './settings'
import { loadEmailConfig, sendEmailWithConfig, type EmailConfig } from './email'
import { renderEmailTemplate } from './email-template'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'
import { waitUntil } from './cf-env'
import { parseSignupSettings, signupReward, type SignupReward, type SignupSettings } from '../../shared/lib/signup-prompt'

/**
 * The site's mailing list (`mailing_list_subscribers`): signups from the popup and the
 * Signup box block, double opt-in, unsubscribe, and the optional copy to a Brevo list.
 *
 * Mail to the list goes only through the site's own third-party provider (Resend, Brevo,
 * ZeptoMail) — never Cloudflare's binding, whose terms cover transactional mail only, and
 * never the console fallback, which would silently drop a confirmation and leave the
 * visitor stuck at "pending".
 */

export const SIGNUP_SETTING_KEY = 'mailing_list.signup'

/** A confirmation email isn't resent to the same address more often than this. */
const CONFIRM_RESEND_INTERVAL_MS = 10 * 60_000

export type SubscriberRow = typeof mailingListSubscribers.$inferSelect

export async function getSignupSettings(event: H3Event): Promise<SignupSettings> {
  return parseSignupSettings(await resolveSetting(event, SIGNUP_SETTING_KEY))
}

/** True when the site's email provider can send list mail (a third-party one with its key). */
export function canSendListEmail(config: Pick<EmailConfig, 'emailProvider' | 'resendApiKey' | 'brevoApiKey' | 'zeptoApiKey'>): boolean {
  switch (config.emailProvider) {
    case 'resend': return Boolean(config.resendApiKey)
    case 'brevo': return Boolean(config.brevoApiKey)
    case 'zepto': return Boolean(config.zeptoApiKey)
    default: return false
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// ── Signed links ────────────────────────────────────────────────────────────
// HMAC of the row id under the deployment secret, so nothing is stored and a link can't
// be built for someone else's row. Purpose-bound: a confirm token can't unsubscribe.

type LinkPurpose = 'confirm' | 'unsubscribe'

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

export function subscriberToken(purpose: LinkPurpose, siteId: string, id: string): Promise<string> {
  return hmacSha256Hex(linkSecret(), `mailing-list:${purpose}:${siteId}:${id}`)
}

export async function verifySubscriberToken(purpose: LinkPurpose, siteId: string, id: string, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false
  return constantTimeEqualHex(await subscriberToken(purpose, siteId, id), token)
}

export async function subscriberLink(event: H3Event, purpose: LinkPurpose, siteId: string, id: string): Promise<string> {
  const token = await subscriberToken(purpose, siteId, id)
  const params = new URLSearchParams({ id, token })
  return `${getRequestURL(event).origin}/mailing-list/${purpose}?${params}`
}

/**
 * RFC 8058 one-click target — mail clients POST here directly, with no page in between.
 * Not called yet: it's for the List-Unsubscribe header of newsletters (docs/roadmap.md,
 * "Mailing list: what's next"). Confirmation emails aren't list mail and don't need it.
 */
export async function oneClickUnsubscribeUrl(event: H3Event, siteId: string, id: string): Promise<string> {
  const token = await subscriberToken('unsubscribe', siteId, id)
  const params = new URLSearchParams({ id, token })
  return `${getRequestURL(event).origin}/api/public/mailing-list/unsubscribe?${params}`
}

// ── Signing up ──────────────────────────────────────────────────────────────

export interface SignupInput {
  email: string
  name?: string
  source: 'popup' | 'block'
  path?: string
}

export interface SignupOutcome {
  /** What the visitor should see: "check your inbox" or "you're in". */
  status: 'pending' | 'subscribed'
  /** Only for a completed (single opt-in) signup — with double opt-in it waits for the confirm page. */
  reward: SignupReward | null
}

/**
 * Adds or re-adds an address. Answers the same way whether or not the address was already
 * on the list, so the form can't be used to find out who is subscribed.
 */
export async function signUp(event: H3Event, input: SignupInput): Promise<SignupOutcome> {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const settings = await getSignupSettings(event)
  const email = normalizeEmail(input.email)
  const name = input.name?.trim().slice(0, 100) || null
  const ip = getHeader(event, 'cf-connecting-ip') ?? null
  const now = new Date().toISOString()

  const existing = await db.query.mailingListSubscribers.findFirst({
    where: and(eq(mailingListSubscribers.siteId, siteId), eq(mailingListSubscribers.email, email)),
  })

  if (existing?.status === 'subscribed') {
    return { status: 'subscribed', reward: signupReward(settings) }
  }

  const fresh = {
    name: name ?? existing?.name ?? null,
    source: input.source,
    sourcePath: input.path?.slice(0, 500) ?? null,
    consentText: settings.consentText || null,
    ipAddress: ip,
    updatedAt: now,
  }

  if (!settings.doubleOptIn) {
    const id = existing?.id ?? ulid()
    if (existing) {
      await db.update(mailingListSubscribers)
        .set({ ...fresh, status: 'subscribed', confirmedAt: now, unsubscribedAt: null })
        .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
    }
    else {
      await db.insert(mailingListSubscribers).values({ id, siteId, email, ...fresh, status: 'subscribed', confirmedAt: now })
        .onConflictDoNothing()
    }
    queueListSync(event, settings, siteId, id)
    return { status: 'subscribed', reward: signupReward(settings) }
  }

  const id = existing?.id ?? ulid()
  if (existing) {
    await db.update(mailingListSubscribers)
      .set({ ...fresh, status: 'pending', unsubscribedAt: null })
      .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
  }
  else {
    await db.insert(mailingListSubscribers).values({ id, siteId, email, ...fresh, status: 'pending' })
      .onConflictDoNothing()
  }

  const lastSent = existing?.confirmSentAt ? Date.parse(existing.confirmSentAt) : 0
  if (Date.now() - lastSent >= CONFIRM_RESEND_INTERVAL_MS) {
    // A failed send is logged in email_log and the row stays pending — Admin → Mailing
    // list shows it and can resend once the provider is fixed.
    await sendConfirmationEmail(event, siteId, id, email).catch((err) => {
      console.error('[mailing-list] Confirmation email failed:', err)
    })
  }
  return { status: 'pending', reward: null }
}

/**
 * Sends the double opt-in email. Refuses (throws) unless the site has a third-party email
 * provider set up — list mail never goes out through Cloudflare or the console fallback.
 */
export async function sendConfirmationEmail(event: H3Event, siteId: string, id: string, email: string): Promise<void> {
  const config = await loadEmailConfig(event)
  if (!canSendListEmail(config)) {
    throw new Error('No third-party email provider is set up (Settings → Email), so the confirmation email was not sent.')
  }
  const accentColor = await resolveSetting(event, 'theme.primary_color')
  const siteName = config.siteName || config.domain
  const { html, text } = renderEmailTemplate({
    siteName,
    accentColor: typeof accentColor === 'string' ? accentColor : undefined,
    preheader: `One click to finish subscribing to ${siteName}.`,
    heading: 'Please confirm your subscription',
    paragraphs: [`Someone (hopefully you) asked to join the ${siteName} mailing list with this address.`],
    action: { label: 'Yes, subscribe me', url: await subscriberLink(event, 'confirm', siteId, id) },
    footnote: 'If you didn\'t ask for this, ignore this email — you won\'t be added.',
  })
  await sendEmailWithConfig(config, {
    to: email,
    subject: `Confirm your subscription to ${siteName}`,
    html,
    text,
    category: 'mailing_list',
  }, event)
  await useDb(event).update(mailingListSubscribers)
    .set({ confirmSentAt: new Date().toISOString() })
    .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
}

/** Finishes a double opt-in. Returns null for an unknown row or a bad token. */
export async function confirmSubscriber(event: H3Event, id: string, token: string): Promise<{ reward: SignupReward | null; settings: SignupSettings } | null> {
  const siteId = event.context.siteId as string
  if (!(await verifySubscriberToken('confirm', siteId, id, token))) return null
  const db = useDb(event)
  const row = await db.query.mailingListSubscribers.findFirst({
    where: and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)),
  })
  if (!row) return null
  const settings = await getSignupSettings(event)
  // Confirming again (a second click) is fine; an old link must not undo an unsubscribe.
  if (row.status === 'pending') {
    const now = new Date().toISOString()
    await db.update(mailingListSubscribers)
      .set({ status: 'subscribed', confirmedAt: now, updatedAt: now })
      .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
    queueListSync(event, settings, siteId, id)
  }
  else if (row.status === 'unsubscribed') {
    return { reward: null, settings }
  }
  return { reward: signupReward(settings), settings }
}

/** Takes an address off the list. Returns false for an unknown row or a bad token. */
export async function unsubscribe(event: H3Event, id: string, token: string): Promise<boolean> {
  const siteId = event.context.siteId as string
  if (!(await verifySubscriberToken('unsubscribe', siteId, id, token))) return false
  return markUnsubscribed(event, siteId, id)
}

export async function markUnsubscribed(event: H3Event, siteId: string, id: string): Promise<boolean> {
  const db = useDb(event)
  const row = await db.query.mailingListSubscribers.findFirst({
    where: and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)),
    columns: { status: true },
  })
  if (!row) return false
  if (row.status !== 'unsubscribed') {
    const now = new Date().toISOString()
    await db.update(mailingListSubscribers)
      .set({ status: 'unsubscribed', unsubscribedAt: now, updatedAt: now })
      .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
    queueListSync(event, await getSignupSettings(event), siteId, id)
  }
  return true
}

// ── Brevo list sync ─────────────────────────────────────────────────────────

function queueListSync(event: H3Event, settings: SignupSettings, siteId: string, id: string): void {
  if (!settings.brevoListId) return
  waitUntil(event, syncSubscriberToBrevo(event, settings.brevoListId, siteId, id).catch((err) => {
    console.error('[mailing-list] Brevo sync failed:', err)
  }))
}

/**
 * Copies a row's current state to the site's Brevo contact list: subscribed → added
 * (or updated), anything else → removed from the list. Records the outcome on the row so
 * Admin → Mailing list can show failures.
 */
export async function syncSubscriberToBrevo(event: H3Event, listId: number, siteId: string, id: string): Promise<void> {
  const db = useDb(event)
  const row = await db.query.mailingListSubscribers.findFirst({
    where: and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)),
  })
  if (!row || row.status === 'pending') return

  const apiKey = await resolveSetting(event, 'email.brevo_api_key', 'brevoApiKey') as string | undefined
  let error: string | null = null
  if (!apiKey) {
    error = 'No Brevo API key is set (Settings → Email).'
  }
  else {
    const headers = { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }
    const res = row.status === 'subscribed'
      ? await fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            email: row.email,
            listIds: [listId],
            updateEnabled: true,
            ...(row.name ? { attributes: { FIRSTNAME: row.name } } : {}),
          }),
        })
      : await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}/contacts/remove`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ emails: [row.email] }),
        })
    // Removing an address that was never on the list is a 400 "already removed" — not a failure.
    if (!res.ok && !(row.status !== 'subscribed' && res.status === 400)) {
      error = `Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`
    }
  }

  await db.update(mailingListSubscribers)
    .set(error ? { syncError: error } : { syncedAt: new Date().toISOString(), syncError: null })
    .where(and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)))
}

// ── Admin helpers ───────────────────────────────────────────────────────────

export async function subscriberCounts(event: H3Event, siteId: string): Promise<Record<'pending' | 'subscribed' | 'unsubscribed', number>> {
  const rows = await useDb(event)
    .select({ status: mailingListSubscribers.status, n: sql<number>`count(*)` })
    .from(mailingListSubscribers)
    .where(eq(mailingListSubscribers.siteId, siteId))
    .groupBy(mailingListSubscribers.status)
  const counts = { pending: 0, subscribed: 0, unsubscribed: 0 }
  for (const r of rows) counts[r.status] = Number(r.n)
  return counts
}

/** One CSV field: quoted, quotes doubled, and a leading formula character neutralised. */
export function csvField(value: string | null | undefined): string {
  let v = value ?? ''
  // Spreadsheet apps run a cell starting with = + - @ as a formula (CSV injection).
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return `"${v.replace(/"/g, '""')}"`
}
