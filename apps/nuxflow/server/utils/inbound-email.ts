import type { H3Event } from 'h3'
import PostalMime, { type Address, type Attachment, type Email } from 'postal-mime'
import { z } from 'zod'
import { generateObject } from 'ai'
import { ulid } from 'ulid'
import { and, eq, gt, inArray, or } from 'drizzle-orm'
import {
  emailMessages, mailboxes, siteDirectory, sites, siteSettings,
  type EmailAttachmentMeta, type EmailAuthResults,
} from '@nuxflow/db/schema'
import { requireSiteId } from './site-context'
import { useDb, type Db } from './db'
import { createSystemEvent } from './system-event'
import { getAiSdkModel, callAiOrThrow } from './ai-sdk'
import { notifySiteRole } from './notify'
import { stripHtmlToPlainText } from './html-to-tiptap'
import { checkPlanLimit, planLimitMessage } from './hosting-plans'
import { countUsage } from './usage'
import { noticePlanLimitOnce } from './plan-limit-notice'
import { bufferToHex } from './buffer'
import { isMemberPool } from './control-plane'
import { callPool, poolAdminStub, type PoolAdminStub } from './pools'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { POOL_ID_RE } from '../../shared/lib/pool-id'
import { isServedCopy } from './move-state'
import { handlePostByEmail } from './post-by-email'
import { getCfEnv, getCloudflareContext } from './cf-env'

/**
 * Inbound email — Cloudflare Email Routing → this Worker's `email()` export (Nitro's
 * `cloudflare:email` hook, see server/plugins/inbound-email.ts) → here.
 *
 * Each receiving domain has ONE catch-all routing rule pointing at the Worker; which
 * addresses exist is decided entirely by the `mailboxes` table, so admins create and
 * delete addresses in NuxFlow with no Cloudflare API call. Two ways a message reaches a
 * site:
 *
 *   1. The site's own domain (`contact@acme.com`) — requires that domain to be a zone in
 *      this Cloudflare account with Email Routing enabled (it takes over the domain's MX).
 *   2. The operator's shared platform domain (NUXT_INBOUND_EMAIL_DOMAIN), as
 *      `<handle>+<mailbox>@in.platform.com` — for tenants whose domain lives elsewhere or
 *      already has a mail host; they point a forward from their own mailbox at it.
 *      `<handle>@…` with no `+mailbox` goes to the site's catch-all mailbox.
 *
 * Nitro runs the hook inside `ctx.waitUntil()` and returns from `email()` at once, after
 * which the message can no longer be forwarded or rejected — so the Worker's own entry
 * (server/cloudflare-entry.ts) makes `email()` wait for this to finish.
 *
 * On a hosting platform, every receiving domain's mail reaches the control plane; mail for
 * a site in a member pool is handed to that pool ("Member pools" below).
 */

export const MAX_INBOUND_BYTES = 25 * 1024 * 1024
/** Per-body cap in D1 — the full original is always kept in R2 at `rawKey`. */
export const MAX_STORED_BODY_CHARS = 200_000
export const MAX_ATTACHMENTS = 20
/** A local part of `*` is the site's catch-all mailbox. */
export const CATCH_ALL_LOCAL_PART = '*'
export const INBOUND_HANDLE_SETTING = 'email.inbound_handle'

type MailboxRow = typeof mailboxes.$inferSelect

// ── Address resolution ──────────────────────────────────────────────────────────────

export interface ParsedRecipient {
  local: string
  /** The `+tag` sub-address, if any (`contact+urgent@` → 'urgent'). */
  tag: string | null
  domain: string
}

export function parseRecipient(address: string): ParsedRecipient | null {
  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return null
  const local = address.slice(0, at).trim().toLowerCase()
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, '')
  const plus = local.indexOf('+')
  return plus === -1
    ? { local, tag: null, domain }
    : { local: local.slice(0, plus), tag: local.slice(plus + 1) || null, domain }
}

export interface ResolvedRecipient {
  siteId: string
  siteDomain: string
  mailbox: MailboxRow
  /** True when the message arrived on the shared platform domain, not the site's own. */
  viaPlatform: boolean
}

async function findMailbox(db: Db, siteId: string, localPart: string | null): Promise<MailboxRow | null> {
  if (localPart) {
    const exact = await db.query.mailboxes.findFirst({
      where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.localPart, localPart), eq(mailboxes.enabled, true)),
    })
    if (exact) return exact
  }
  // Catch-all only ever resolves to an inbox — a post-by-email address must be matched
  // exactly, since its secret local part is its whole authorisation.
  const catchAll = await db.query.mailboxes.findFirst({
    where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.localPart, CATCH_ALL_LOCAL_PART), eq(mailboxes.enabled, true)),
  })
  return catchAll?.kind === 'inbox' ? catchAll : null
}

export async function resolveRecipient(db: Db, to: string, platformDomain: string): Promise<ResolvedRecipient | null> {
  const parsed = parseRecipient(to)
  if (!parsed) return null

  const platform = platformDomain.trim().toLowerCase()
  if (platform && parsed.domain === platform) {
    // <handle>+<mailbox>@platform — parseRecipient already split on the first '+'.
    const setting = await db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.key, INBOUND_HANDLE_SETTING), eq(siteSettings.value, parsed.local)),
      columns: { siteId: true },
    })
    if (!setting) return null
    const site = await db.query.sites.findFirst({ where: eq(sites.id, setting.siteId), columns: { id: true, domain: true, status: true, moveState: true } })
    if (!site || site.status === 'suspended' || !isServedCopy(site.moveState)) return null
    const mailbox = await findMailbox(db, site.id, parsed.tag)
    return mailbox ? { siteId: site.id, siteDomain: site.domain, mailbox, viaPlatform: true } : null
  }

  // A site configured as `www.acme.com` still receives `contact@acme.com`.
  const site = await db.query.sites.findFirst({
    where: inArray(sites.domain, [parsed.domain, `www.${parsed.domain}`]),
    columns: { id: true, domain: true, status: true, moveState: true },
  })
  // A copy mid-move that isn't the live one (site-move.ts) never takes mail; the live one
  // does, and its new mail is copied across just before the switch.
  if (!site || site.status === 'suspended' || !isServedCopy(site.moveState)) return null
  const mailbox = await findMailbox(db, site.id, parsed.local)
  return mailbox ? { siteId: site.id, siteDomain: site.domain, mailbox, viaPlatform: false } : null
}

// ── Parsing helpers ─────────────────────────────────────────────────────────────────

/**
 * Pulls spf/dkim/dmarc verdicts out of an `Authentication-Results` header (RFC 8601),
 * first occurrence of each, plus the signing domain of every passing DKIM signature.
 *
 * Only the header added by the receiving MX (Cloudflare) is meaningful — anything below
 * it came from the sender and can say whatever they like. Callers pass
 * `message.headers.get(...)`, which joins every copy with ", " topmost first, so parsing
 * stops where the second header begins: a comma followed by an authserv-id and `;`. An
 * authserv-id never contains `=`, while every result entry (`dkim=pass …`) does.
 */
export function parseAuthResults(header: string | null | undefined): EmailAuthResults {
  const out: EmailAuthResults = {}
  if (!header) return out
  const own = header.split(/,\s*(?=[^\s;,=]+\s*;)/)[0]!
  const dkimPassDomains: string[] = []
  for (const entry of own.split(';')) {
    const match = /^\s*(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(entry)
    if (!match) continue
    const key = match[1]!.toLowerCase() as 'spf' | 'dkim' | 'dmarc'
    const result = match[2]!.toLowerCase()
    out[key] ??= result
    if (key === 'dkim' && result === 'pass') {
      const domain = /\bheader\.d\s*=\s*([a-z0-9.-]+)/i.exec(entry)?.[1]
        ?? /\bheader\.i\s*=\s*[^\s@;]*@([a-z0-9.-]+)/i.exec(entry)?.[1]
      if (domain) dkimPassDomains.push(domain.toLowerCase().replace(/\.$/, ''))
    }
  }
  if (dkimPassDomains.length) out.dkimPassDomains = dkimPassDomains
  return out
}

/**
 * Whether the From domain itself vouched for the message: DMARC passed (which already
 * means aligned with From), or a DKIM signature from that domain (or a parent of it)
 * passed. A bare `dkim=pass` isn't enough — anyone can sign mail with their own domain's
 * key while putting someone else's address in From.
 */
export function isSenderAuthenticated(auth: EmailAuthResults, fromAddress: string): boolean {
  if (auth.dmarc === 'pass') return true
  const fromDomain = fromAddress.toLowerCase().split('@').pop()?.replace(/\.$/, '')
  if (!fromDomain || !fromAddress.includes('@')) return false
  return (auth.dkimPassDomains ?? []).some(d => d.includes('.') && (fromDomain === d || fromDomain.endsWith(`.${d}`)))
}

export function firstMailbox(addr: Address | undefined): { address: string; name: string } | null {
  if (!addr) return null
  if (addr.address) return { address: addr.address.toLowerCase(), name: addr.name }
  const first = addr.group?.[0]
  return first ? { address: first.address.toLowerCase(), name: first.name } : null
}

export function makeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Message-IDs named by In-Reply-To/References, angle brackets kept (stored form). */
function referencedIds(parsed: Email): string[] {
  const ids = new Set<string>()
  for (const src of [parsed.inReplyTo, parsed.references]) {
    for (const m of (src ?? '').matchAll(/<[^<>\s]+>/g)) ids.add(m[0])
  }
  return [...ids].slice(0, 20)
}

// postal-mime is asked for 'arraybuffer' encoding, so content is always a plain
// ArrayBuffer-backed view here (never a SharedArrayBuffer) — the cast only narrows the type.
export function attachmentBytes(att: Attachment): Uint8Array<ArrayBuffer> {
  if (typeof att.content === 'string') return new TextEncoder().encode(att.content)
  return (att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content)) as Uint8Array<ArrayBuffer>
}

function randomSuffix(): string {
  return bufferToHex(crypto.getRandomValues(new Uint8Array(16)))
}

function getBucket(event: H3Event): R2Bucket | null {
  return (getCfEnv(event)?.MEDIA_BUCKET as R2Bucket | undefined) ?? null
}

/**
 * R2 keys for received mail live under `_private/`, which the public
 * `/_nuxflow/media/<siteId>/…` route never serves (it requires the `<siteId>/` prefix).
 * The random suffix keeps them unguessable too, for a bucket that also has a public
 * r2.dev/custom domain attached.
 */
export function privateEmailKey(siteId: string, id: string, suffix: string): string {
  return `_private/${siteId}/email/${id}-${suffix}`
}

function reject(message: ForwardableEmailMessage, reason: string): void {
  console.warn(`[inbound-email] Not accepted (${reason}): ${message.from} → ${message.to}`)
  try {
    message.setReject(reason)
  }
  catch {
    // Already past the point where a reject is possible — see the file header.
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────────────

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: unknown,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<void> {
  const lookupEvent = createSystemEvent({ env, ctx })
  const db = useDb(lookupEvent)
  const platformDomain = String(useRuntimeConfig().inboundEmailDomain ?? '')

  const resolved = await resolveRecipient(db, message.to, platformDomain)
  if (!resolved) {
    // On a hosting platform's control plane, an address it doesn't know may belong to a
    // site in a member pool — Email Routing only ever delivers to this Worker.
    if (!isMemberPool()) {
      const poolId = await poolForRecipient(db, message.to, platformDomain)
      const stub = poolId ? poolAdminStub(lookupEvent, poolId) : null
      if (poolId && stub) return deliverToPool(message, stub, poolId)
    }
    return reject(message, 'Unknown recipient')
  }
  if (message.rawSize > MAX_INBOUND_BYTES) return reject(message, 'Message too large')
  // Our own outbound mail echoing back (a forwardTo pointing at another of this site's
  // addresses, a misconfigured provider) must never loop.
  if (message.from.toLowerCase() === message.to.toLowerCase()) return reject(message, 'Loop detected')

  // Forward first: it's independent of our own storage succeeding.
  await forwardIfAsked(message, forwardAddress(resolved.mailbox, message.to))

  const refused = await acceptForSite(env, ctx, resolved, {
    from: message.from,
    to: message.to,
    authResults: message.headers.get('authentication-results'),
    readRaw: async () => new Uint8Array(await new Response(message.raw).arrayBuffer()),
  })
  if (refused) reject(message, refused)
}

/** Where an inbox mailbox forwards a copy, if anywhere (never back to the address it came to). */
function forwardAddress(mailbox: MailboxRow, to: string): string | null {
  return mailbox.kind === 'inbox' && mailbox.forwardTo && mailbox.forwardTo.toLowerCase() !== to.toLowerCase()
    ? mailbox.forwardTo
    : null
}

/** Cloudflare only forwards to verified destination addresses; anything else fails here and is logged. */
async function forwardIfAsked(message: ForwardableEmailMessage, forwardTo: string | null): Promise<void> {
  if (!forwardTo) return
  try {
    await message.forward(forwardTo)
  }
  catch (err) {
    console.error(`[inbound-email] Forward to ${forwardTo} failed (is it a verified destination address?):`, err)
  }
}

interface ReceivedMail {
  from: string
  to: string
  /** The receiving MX's Authentication-Results header. */
  authResults: string | null
  readRaw(): Promise<Uint8Array>
}

/**
 * Keeps a message for the site that has its address: in the inbox, or as a draft for a
 * posting address. Returns why it wasn't kept, or null. Used for this Worker's own sites
 * and, in a member pool, for mail its control plane passes on (poolReceiveEmail).
 */
async function acceptForSite(env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void } | undefined, resolved: ResolvedRecipient, mail: ReceivedMail): Promise<string | null> {
  const event = createSystemEvent({ env, ctx, siteId: resolved.siteId, host: resolved.siteDomain })
  const db = useDb(event)

  // The hosting plan's "Emails received a month". Forwarding still happens — it costs
  // nothing to keep — but nothing more is stored or processed until the 1st.
  const inbound = await checkPlanLimit(db, resolved.siteId, 'inbound')
  if (!inbound.allowed) {
    await noticePlanLimitOnce(event, resolved.siteId, 'inbound', 'Incoming email is paused',
      `This site has received its plan's ${(inbound.max ?? 0).toLocaleString('en')} emails for this month. New mail isn't kept in the inbox, or turned into drafts, until the 1st. Mail that's set to forward still forwards.`)
    return 'Mailbox over its monthly limit'
  }

  const raw = await mail.readRaw()
  const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' })
  const auth = parseAuthResults(mail.authResults)

  // Providers retry delivery; a Message-ID we've already stored means this is a repeat.
  const messageId = parsed.messageId?.trim() || null
  if (messageId) {
    const dup = await db.query.emailMessages.findFirst({
      where: and(eq(emailMessages.siteId, resolved.siteId), eq(emailMessages.messageId, messageId)),
      columns: { id: true },
    })
    if (dup) return null
  }
  countUsage(event, 'inbound_emails')

  const input: InboundInput = { event, resolved, parsed, raw, auth, envelopeFrom: mail.from.toLowerCase(), envelopeTo: mail.to.toLowerCase(), messageId }
  if (resolved.mailbox.kind === 'post') {
    await handlePostByEmail(input)
  }
  else {
    await storeInboxMessage(input)
  }
  return null
}

// ── Member pools ────────────────────────────────────────────────────────────────────

/**
 * The member pool whose site has this address, as far as the control plane can tell: a
 * site address the router sends to a pool (`site_directory`, `www.` included), or a
 * handle on the shared inbound domain — a pool's handles end in `.<pool id>`
 * (inbox.ts ensureInboundHandle), so they need no directory entry.
 */
export async function poolForRecipient(db: Db, to: string, platformDomain: string): Promise<string | null> {
  const parsed = parseRecipient(to)
  if (!parsed) return null
  const platform = platformDomain.trim().toLowerCase()
  if (platform && parsed.domain === platform) {
    const dot = parsed.local.lastIndexOf('.')
    const poolId = parsed.local.slice(dot + 1)
    return dot > 0 && POOL_ID_RE.test(poolId) ? poolId : null
  }
  const [row] = await db.select({ poolId: siteDirectory.poolId }).from(siteDirectory)
    .where(inArray(siteDirectory.hostname, [parsed.domain, `www.${parsed.domain}`])).limit(1)
  return row?.poolId ?? null
}

/**
 * Hands a message to the pool that has its address: asks where to forward a copy
 * (forwarding needs the original message, which only this Worker holds), forwards, then
 * sends the bytes over for the pool to keep.
 */
async function deliverToPool(message: ForwardableEmailMessage, stub: PoolAdminStub, poolId: string): Promise<void> {
  const what = `pool ${poolId}`
  const recipient = await callPool(stub.inboundRecipient({ protocol: POOL_PROTOCOL, to: message.to }), what)
  if (!recipient) return reject(message, 'Unknown recipient')
  if (message.rawSize > MAX_INBOUND_BYTES) return reject(message, 'Message too large')
  if (message.from.toLowerCase() === message.to.toLowerCase()) return reject(message, 'Loop detected')

  await forwardIfAsked(message, recipient.forwardTo)

  const raw = await new Response(message.raw).arrayBuffer()
  const { refused } = await callPool(stub.receiveEmail({
    protocol: POOL_PROTOCOL,
    from: message.from,
    to: message.to,
    authResults: message.headers.get('authentication-results'),
    raw,
  }), what)
  if (refused) reject(message, refused)
}

/** A member pool's answer to "is this one of your sites' addresses?", with where it forwards a copy. */
export async function poolInboundRecipient(event: H3Event, input: { protocol: number; to: string }): Promise<{ forwardTo: string | null } | null> {
  assertCompatibleProtocol(input.protocol)
  const resolved = await resolveRecipient(useDb(event), input.to, String(useRuntimeConfig().inboundEmailDomain ?? ''))
  return resolved ? { forwardTo: forwardAddress(resolved.mailbox, input.to) } : null
}

/** A member pool keeping a message its control plane received for one of its sites. */
export async function poolReceiveEmail(event: H3Event, input: { protocol: number; from: string; to: string; authResults: string | null; raw: ArrayBuffer }): Promise<{ refused: string | null }> {
  assertCompatibleProtocol(input.protocol)
  const resolved = await resolveRecipient(useDb(event), input.to, String(useRuntimeConfig().inboundEmailDomain ?? ''))
  if (!resolved) return { refused: 'Unknown recipient' }
  if (input.raw.byteLength > MAX_INBOUND_BYTES) return { refused: 'Message too large' }
  const refused = await acceptForSite(getCfEnv(event), getCloudflareContext(event)?.context, resolved, {
    from: input.from,
    to: input.to,
    authResults: input.authResults,
    readRaw: async () => new Uint8Array(input.raw),
  })
  return { refused }
}

export interface InboundInput {
  event: H3Event
  resolved: ResolvedRecipient
  parsed: Email
  raw: Uint8Array
  auth: EmailAuthResults
  envelopeFrom: string
  envelopeTo: string
  messageId: string | null
}

// ── Inbox ───────────────────────────────────────────────────────────────────────────

/**
 * Keeps the raw message and its attachments in R2. Those bytes count towards the site's
 * storage limit (`storedBytes` on the row, summed in hosting-plans.ts); when they won't fit,
 * nothing goes to R2 — the message text is still kept in the inbox — and the admins are
 * told once that month.
 */
async function storeRawAndAttachments(event: H3Event, siteId: string, id: string, raw: Uint8Array, attachments: Attachment[]): Promise<{ rawKey: string | null; meta: EmailAttachmentMeta[]; storedBytes: number }> {
  const suffix = randomSuffix()
  let rawKey: string | null = null
  const meta: EmailAttachmentMeta[] = []
  let storedBytes = 0

  const kept = attachments.slice(0, MAX_ATTACHMENTS)
  const wanted = raw.byteLength + kept.reduce((sum, att) => sum + attachmentBytes(att).byteLength, 0)
  let bucket = getBucket(event)
  if (bucket) {
    const storage = await checkPlanLimit(useDb(event), siteId, 'storage', wanted)
    if (!storage.allowed) {
      bucket = null
      console.warn(`[inbound-email] Storage limit reached for site ${siteId}; keeping message ${id} without its raw copy or attachments`)
      await noticePlanLimitOnce(event, siteId, 'storage', 'Email attachments are not being kept',
        `${planLimitMessage('storage', storage.max ?? 0)} New emails still arrive in the inbox, but their attachments aren't kept until some space is freed.`)
    }
  }

  if (bucket) {
    try {
      rawKey = `${privateEmailKey(siteId, id, suffix)}.eml`
      await bucket.put(rawKey, raw, { httpMetadata: { contentType: 'message/rfc822' } })
      storedBytes += raw.byteLength
    }
    catch (err) {
      console.error('[inbound-email] Failed to store raw message in R2:', err)
      rawKey = null
    }
  }

  for (const [i, att] of kept.entries()) {
    const bytes = attachmentBytes(att)
    const entry: EmailAttachmentMeta = {
      filename: (att.filename || `attachment-${i + 1}`).slice(0, 200),
      contentType: (att.mimeType || 'application/octet-stream').toLowerCase(),
      size: bytes.byteLength,
      key: null,
    }
    if (bucket) {
      try {
        const key = `${privateEmailKey(siteId, id, suffix)}/${i}`
        await bucket.put(key, bytes, { httpMetadata: { contentType: entry.contentType } })
        entry.key = key
        storedBytes += bytes.byteLength
      }
      catch (err) {
        console.error('[inbound-email] Failed to store attachment in R2:', err)
      }
    }
    meta.push(entry)
  }
  return { rawKey, meta, storedBytes }
}

/** Subject with any number of leading Re:/Fwd:/AW:/SV: prefixes removed, lowercased. */
export function normalizeSubject(subject: string): string {
  // One prefix per pass, not a repeated group — a single regex over "Re: Re: Re: …" with
  // nested optional whitespace backtracks exponentially on hostile input.
  const prefix = /^(?:re|fwd?|aw|sv|antw) ?(?:\[\d+\])? ?:/i
  let s = subject.trim()
  for (let i = 0; i < 20 && prefix.test(s); i++) s = s.replace(prefix, '').trim()
  return s.toLowerCase()
}

/**
 * Which thread an incoming message belongs to: first by In-Reply-To/References against
 * stored Message-IDs; failing that (providers other than Cloudflare return opaque ids
 * for our replies, so the customer's In-Reply-To won't match), by the same correspondent
 * and the same subject minus its Re:/Fwd: prefixes within the last 30 days.
 */
async function resolveThreadId(db: Db, siteId: string, parsed: Email, sender: string, fallback: string): Promise<string> {
  const refs = referencedIds(parsed)
  if (refs.length) {
    const parent = await db.query.emailMessages.findFirst({
      where: and(eq(emailMessages.siteId, siteId), inArray(emailMessages.messageId, refs)),
      columns: { threadId: true },
    })
    if (parent) return parent.threadId
  }

  const subject = normalizeSubject(parsed.subject ?? '')
  if (!subject) return fallback
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
  const recent = await db.query.emailMessages.findMany({
    where: and(
      eq(emailMessages.siteId, siteId),
      gt(emailMessages.createdAt, since),
      or(
        and(eq(emailMessages.direction, 'inbound'), eq(emailMessages.fromAddress, sender)),
        and(eq(emailMessages.direction, 'outbound'), eq(emailMessages.toAddress, sender)),
      ),
    ),
    columns: { threadId: true, subject: true },
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit: 20,
  })
  return recent.find(m => normalizeSubject(m.subject) === subject)?.threadId ?? fallback
}

async function storeInboxMessage(input: InboundInput): Promise<void> {
  const { event, resolved, parsed, raw, auth, envelopeFrom, envelopeTo, messageId } = input
  const db = useDb(event)
  const id = ulid()

  const from = firstMailbox(parsed.from) ?? { address: envelopeFrom, name: '' }
  const threadId = await resolveThreadId(db, resolved.siteId, parsed, from.address, id)
  const { rawKey, meta, storedBytes } = await storeRawAndAttachments(event, resolved.siteId, id, raw, parsed.attachments)
  const text = parsed.text ?? (parsed.html ? stripHtmlToPlainText(parsed.html) : '')
  const subject = (parsed.subject ?? '').slice(0, 998)

  await db.insert(emailMessages).values({
    id,
    siteId: resolved.siteId,
    mailboxId: resolved.mailbox.id,
    threadId,
    direction: 'inbound',
    messageId,
    inReplyTo: parsed.inReplyTo?.slice(0, 998) ?? null,
    references: parsed.references?.slice(0, 4000) ?? null,
    // Reply goes to the header From (what the sender's client shows and expects a reply
    // at), not the envelope sender, which is often a bounce address.
    fromAddress: from.address,
    fromName: from.name || null,
    toAddress: envelopeTo,
    subject,
    snippet: makeSnippet(text),
    textBody: text ? text.slice(0, MAX_STORED_BODY_CHARS) : null,
    htmlBody: parsed.html ? parsed.html.slice(0, MAX_STORED_BODY_CHARS) : null,
    attachments: meta,
    auth,
    rawKey,
    size: raw.byteLength,
    storedBytes,
  })

  const spam = await triageMessage(event, id, { subject, text, from: from.address })

  if (resolved.mailbox.notify && !spam) {
    const who = from.name ? `${from.name} <${from.address}>` : from.address
    await notifySiteRole(event, {
      siteId: resolved.siteId,
      minRole: 'editor',
      type: 'inbox.message',
      title: `New email: ${subject || '(no subject)'}`,
      body: `${who} wrote to ${resolved.mailbox.name}: ${makeSnippet(text) || '(no text)'}`,
      data: { emailMessageId: id, threadId },
      sendEmailNotification: true,
      sendPush: true,
      pushUrl: `/admin/inbox?message=${id}`,
      actionLabel: 'Open in inbox',
    })
  }
}

const triageSchema = z.object({
  category: z.enum(['lead', 'support', 'spam', 'other']),
  summary: z.string().max(200),
})

const TRIAGE_SYSTEM = `You triage email arriving at a website's contact addresses. Classify it:
- "lead": a potential customer, client, partnership, or sales enquiry.
- "support": an existing customer or visitor asking for help or reporting a problem.
- "spam": unsolicited bulk advertising, SEO/link-building pitches, scams, phishing, or abuse.
- "other": anything else (newsletters they subscribed to, notifications, personal mail).
Do not mark genuine but negative or critical messages as spam. Then write a one-sentence summary (max 25 words) of what the sender wants.`

/**
 * Best-effort AI triage: category + one-line summary, and spam goes straight to the Spam
 * folder. One `generateObject` call covers both jobs (moderateText() + a separate
 * classifier would be two calls per email). No provider configured → nothing happens and
 * the message stays 'new'. Returns true when the message was marked spam.
 */
async function triageMessage(event: H3Event, id: string, msg: { subject: string; text: string; from: string }): Promise<boolean> {
  try {
    // Set off by whoever sent the email — the visitor AI allowance.
    const model = await getAiSdkModel(event, 'fast', { trigger: 'visitor' })
    if (!model) return false
    const { object } = await callAiOrThrow(() => generateObject({
      model,
      schema: triageSchema,
      system: TRIAGE_SYSTEM,
      prompt: `From: ${msg.from}\nSubject: ${msg.subject}\n\n${msg.text.slice(0, 4000)}`,
      maxOutputTokens: 200,
    }))
    const spam = object.category === 'spam'
    await useDb(event).update(emailMessages)
      .set({ category: object.category, aiSummary: object.summary, ...(spam ? { status: 'spam' as const } : {}) })
      .where(and(eq(emailMessages.id, id), eq(emailMessages.siteId, requireSiteId(event))))
    return spam
  }
  catch (err) {
    console.error('[inbound-email] AI triage failed:', err)
    return false
  }
}
