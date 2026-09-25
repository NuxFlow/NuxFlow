import type { H3Event } from 'h3'
import PostalMime, { type Address, type Attachment, type Email } from 'postal-mime'
import { z } from 'zod'
import { generateObject } from 'ai'
import { ulid } from 'ulid'
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm'
import {
  contentItems, contentTypes, emailMessages, mailboxes, media, sites, siteSettings, users,
  type EmailAttachmentMeta, type EmailAuthResults,
} from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { createSystemEvent } from './system-event'
import { getAiSdkModel, callAiOrThrow } from './ai-sdk'
import { notifySiteRole, sendNotification } from './notify'
import { getUserSiteRole, roleAtLeast, type Role } from './permissions'
import { uniqueContentSlug } from './content-queries'
import { htmlToTipTap, stripHtmlToPlainText, type TTNode } from './html-to-tiptap'
import { getActiveProvider } from './media-providers/index'
import { buildAuditLogInsert, batchWithAudit } from './audit'
import { bufferToHex } from './buffer'

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
 * Nitro runs the hook inside `ctx.waitUntil()` and returns from `email()` immediately, so
 * `setReject()` may be a no-op by the time it's called — nothing here depends on a reject
 * actually bouncing; an unknown recipient is simply not stored.
 */

export const MAX_INBOUND_BYTES = 25 * 1024 * 1024
/** Per-body cap in D1 — the full original is always kept in R2 at `rawKey`. */
export const MAX_STORED_BODY_CHARS = 200_000
const MAX_ATTACHMENTS = 20
/** A local part of `*` is the site's catch-all mailbox. */
export const CATCH_ALL_LOCAL_PART = '*'
export const INBOUND_HANDLE_SETTING = 'email.inbound_handle'
/** Post-by-email drafts allowed per posting address per hour. */
const POST_BY_EMAIL_HOURLY_LIMIT = 20
const DRAFT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_DRAFT_IMAGE_BYTES = 20 * 1024 * 1024

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
    const site = await db.query.sites.findFirst({ where: eq(sites.id, setting.siteId), columns: { id: true, domain: true, status: true } })
    if (!site || site.status === 'suspended') return null
    const mailbox = await findMailbox(db, site.id, parsed.tag)
    return mailbox ? { siteId: site.id, siteDomain: site.domain, mailbox, viaPlatform: true } : null
  }

  // A site configured as `www.acme.com` still receives `contact@acme.com`.
  const site = await db.query.sites.findFirst({
    where: inArray(sites.domain, [parsed.domain, `www.${parsed.domain}`]),
    columns: { id: true, domain: true, status: true },
  })
  if (!site || site.status === 'suspended') return null
  const mailbox = await findMailbox(db, site.id, parsed.local)
  return mailbox ? { siteId: site.id, siteDomain: site.domain, mailbox, viaPlatform: false } : null
}

// ── Parsing helpers ─────────────────────────────────────────────────────────────────

/**
 * Pulls spf/dkim/dmarc verdicts out of an `Authentication-Results` header (RFC 8601),
 * first occurrence of each. Only the header added by the receiving MX (Cloudflare) is
 * meaningful — callers pass `message.headers.get(...)`, whose first value is the topmost,
 * most recently added header.
 */
export function parseAuthResults(header: string | null | undefined): EmailAuthResults {
  const out: EmailAuthResults = {}
  if (!header) return out
  for (const match of header.matchAll(/\b(spf|dkim|dmarc)\s*=\s*([a-z]+)/gi)) {
    const key = match[1]!.toLowerCase() as keyof EmailAuthResults
    out[key] ??= match[2]!.toLowerCase()
  }
  return out
}

export function isSenderAuthenticated(auth: EmailAuthResults): boolean {
  return auth.dmarc === 'pass' || auth.dkim === 'pass'
}

function firstMailbox(addr: Address | undefined): { address: string; name: string } | null {
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
function attachmentBytes(att: Attachment): Uint8Array<ArrayBuffer> {
  if (typeof att.content === 'string') return new TextEncoder().encode(att.content)
  return (att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content)) as Uint8Array<ArrayBuffer>
}

function randomSuffix(): string {
  return bufferToHex(crypto.getRandomValues(new Uint8Array(16)))
}

function getBucket(event: H3Event): R2Bucket | null {
  return (event.context.cloudflare?.env?.MEDIA_BUCKET as R2Bucket | undefined) ?? null
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
  const rc = useRuntimeConfig()

  const resolved = await resolveRecipient(db, message.to, String(rc.inboundEmailDomain ?? ''))
  if (!resolved) return reject(message, 'Unknown recipient')
  if (message.rawSize > MAX_INBOUND_BYTES) return reject(message, 'Message too large')
  // Our own outbound mail echoing back (a forwardTo pointing at another of this site's
  // addresses, a misconfigured provider) must never loop.
  if (message.from.toLowerCase() === message.to.toLowerCase()) return reject(message, 'Loop detected')

  const event = createSystemEvent({ env, ctx, siteId: resolved.siteId, host: resolved.siteDomain })
  const { mailbox } = resolved

  // Forward first: it's independent of our own storage succeeding. Cloudflare only
  // forwards to verified destination addresses; anything else fails here and is logged.
  if (mailbox.kind === 'inbox' && mailbox.forwardTo && mailbox.forwardTo.toLowerCase() !== message.to.toLowerCase()) {
    try {
      await message.forward(mailbox.forwardTo)
    }
    catch (err) {
      console.error(`[inbound-email] Forward to ${mailbox.forwardTo} failed (is it a verified destination address?):`, err)
    }
  }

  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer())
  const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' })
  const auth = parseAuthResults(message.headers.get('authentication-results'))

  // Providers retry delivery; a Message-ID we've already stored means this is a repeat.
  const messageId = parsed.messageId?.trim() || null
  if (messageId) {
    const dup = await useDb(event).query.emailMessages.findFirst({
      where: and(eq(emailMessages.siteId, resolved.siteId), eq(emailMessages.messageId, messageId)),
      columns: { id: true },
    })
    if (dup) return
  }

  const input: InboundInput = { event, resolved, parsed, raw, auth, envelopeFrom: message.from.toLowerCase(), envelopeTo: message.to.toLowerCase(), messageId }
  if (mailbox.kind === 'post') {
    await handlePostByEmail(input)
  }
  else {
    await storeInboxMessage(input)
  }
}

interface InboundInput {
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

async function storeRawAndAttachments(event: H3Event, siteId: string, id: string, raw: Uint8Array, attachments: Attachment[]): Promise<{ rawKey: string | null; meta: EmailAttachmentMeta[] }> {
  const bucket = getBucket(event)
  const suffix = randomSuffix()
  let rawKey: string | null = null
  const meta: EmailAttachmentMeta[] = []

  if (bucket) {
    try {
      rawKey = `${privateEmailKey(siteId, id, suffix)}.eml`
      await bucket.put(rawKey, raw, { httpMetadata: { contentType: 'message/rfc822' } })
    }
    catch (err) {
      console.error('[inbound-email] Failed to store raw message in R2:', err)
      rawKey = null
    }
  }

  for (const [i, att] of attachments.slice(0, MAX_ATTACHMENTS).entries()) {
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
      }
      catch (err) {
        console.error('[inbound-email] Failed to store attachment in R2:', err)
      }
    }
    meta.push(entry)
  }
  return { rawKey, meta }
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
  const { rawKey, meta } = await storeRawAndAttachments(event, resolved.siteId, id, raw, parsed.attachments)
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
    const model = await getAiSdkModel(event, 'fast')
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
      .where(eq(emailMessages.id, id))
    return spam
  }
  catch (err) {
    console.error('[inbound-email] AI triage failed:', err)
    return false
  }
}

// ── Email-to-draft ──────────────────────────────────────────────────────────────────

/** Walks a TipTap doc, dropping image nodes whose src isn't one we uploaded. */
function keepOnlyImages(nodes: TTNode[], allowed: Set<string>): TTNode[] {
  const out: TTNode[] = []
  for (const node of nodes) {
    if (node.type === 'image') {
      const src = (node.attrs as { src?: string } | undefined)?.src
      if (src && allowed.has(src)) out.push(node)
      continue
    }
    out.push(node.content ? { ...node, content: keepOnlyImages(node.content, allowed) } : node)
  }
  return out
}

/** Plain-text body → TipTap paragraphs, dropping a conventional `-- ` signature. */
export function textToTipTap(text: string): TTNode[] {
  const body = text.split(/\r?\n-- \r?\n/)[0] ?? ''
  return body.split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split(/\r?\n/)
      const content: TTNode[] = []
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' })
        if (line) content.push({ type: 'text', text: line })
      })
      return { type: 'paragraph', content }
    })
}

async function rejectPost(input: InboundInput, reason: string, ownerId: string | null): Promise<void> {
  console.warn(`[inbound-email] Post-by-email rejected (${reason}) for mailbox ${input.resolved.mailbox.id}`)
  if (!ownerId) return
  // In-app only — an attacker who learned the address shouldn't be able to make us email
  // the owner once per attempt.
  await sendNotification({
    siteId: input.resolved.siteId,
    userId: ownerId,
    type: 'content.post_by_email',
    title: 'An email to your posting address was not accepted',
    body: `A message from ${input.envelopeFrom} was ignored: ${reason}`,
  }, input.event).catch(err => console.error('[inbound-email] Notify failed:', err))
}

async function handlePostByEmail(input: InboundInput): Promise<void> {
  const { event, resolved, parsed, auth, envelopeFrom, envelopeTo, messageId } = input
  const db = useDb(event)
  const { siteId, mailbox } = resolved
  const ownerId = mailbox.userId

  if (!ownerId) return rejectPost(input, 'this posting address has no owner', null)
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId), columns: { id: true, email: true } })
  if (!owner) return rejectPost(input, 'owner not found', null)

  // Authorisation is three independent checks, all required: the secret address itself,
  // the sender being the owner, and the sender's domain vouching for that (DKIM/DMARC) —
  // From headers are trivially forged, so the address match alone proves nothing. No
  // Authentication-Results at all fails closed.
  const headerFrom = firstMailbox(parsed.from)?.address
  const ownerEmail = owner.email.toLowerCase()
  if (envelopeFrom !== ownerEmail || headerFrom !== ownerEmail) {
    return rejectPost(input, `the sender isn't ${owner.email}`, ownerId)
  }
  if (!isSenderAuthenticated(auth)) {
    return rejectPost(input, 'the sender could not be verified (no DKIM or DMARC pass) — send from your normal mail provider rather than a script or relay', ownerId)
  }

  const roleRow = await getUserSiteRole(db, ownerId, siteId)
  if (!roleRow || !roleAtLeast(roleRow.role as Role, 'author')) {
    return rejectPost(input, 'you no longer have author access to this site', ownerId)
  }

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString().replace('T', ' ').slice(0, 19)
  const [recent] = await db.select({ n: sql<number>`count(*)` }).from(emailMessages)
    .where(and(eq(emailMessages.mailboxId, mailbox.id), gt(emailMessages.createdAt, hourAgo)))
  if ((recent?.n ?? 0) >= POST_BY_EMAIL_HOURLY_LIMIT) {
    return rejectPost(input, `more than ${POST_BY_EMAIL_HOURLY_LIMIT} emails in the last hour`, ownerId)
  }

  // Images: raster attachments go to the media library under the owner's name; inline
  // ones (cid:) are swapped into the HTML in place, the rest appended after the text.
  const provider = await getActiveProvider(event)
  const cidToUrl = new Map<string, string>()
  const trailingImages: string[] = []
  const uploaded = new Set<string>()
  for (const att of parsed.attachments.slice(0, MAX_ATTACHMENTS)) {
    const mimeType = (att.mimeType || '').toLowerCase()
    if (!DRAFT_IMAGE_TYPES.has(mimeType)) continue
    const bytes = attachmentBytes(att)
    if (bytes.byteLength > MAX_DRAFT_IMAGE_BYTES) continue
    const fileId = ulid()
    const ext = mimeType.split('/')[1]!.replace('jpeg', 'jpg')
    const storageKey = `${siteId}/${fileId}.${ext}`
    const name = (att.filename || `image.${ext}`).slice(0, 200)
    try {
      const { url } = await provider.upload(new File([bytes], name, { type: mimeType }), storageKey, siteId)
      await db.insert(media).values({
        id: fileId,
        siteId,
        uploadedBy: ownerId,
        filename: storageKey,
        originalName: name,
        mimeType,
        size: bytes.byteLength,
        url,
        storageProvider: provider.name as 'cloudflare' | 'local' | 'r2' | 's3' | 'bunny',
        storageKey,
      })
      uploaded.add(url)
      const cid = att.contentId?.replace(/^<|>$/g, '')
      if (cid && parsed.html?.includes(`cid:${cid}`)) cidToUrl.set(cid, url)
      else trailingImages.push(url)
    }
    catch (err) {
      // The database fallback provider refuses files over 512 KB — skip the image, keep the post.
      console.error('[inbound-email] Draft image upload failed:', err)
    }
  }

  let body: TTNode[]
  if (parsed.html) {
    let html = parsed.html
    for (const [cid, url] of cidToUrl) html = html.split(`cid:${cid}`).join(url)
    body = keepOnlyImages(htmlToTipTap(html).content, uploaded)
  }
  else {
    body = textToTipTap(parsed.text ?? '')
  }
  for (const url of trailingImages) body.push({ type: 'image', attrs: { src: url } })
  if (!body.length) body = [{ type: 'paragraph' }]

  // Blog post when the site has the type (every seeded site does), else a page.
  const types = await db.query.contentTypes.findMany({
    where: and(eq(contentTypes.siteId, siteId), inArray(contentTypes.slug, ['post', 'page'])),
    columns: { id: true, slug: true },
  })
  const type = types.find(t => t.slug === 'post') ?? types.find(t => t.slug === 'page')
  if (!type) return rejectPost(input, 'this site has no post or page content type', ownerId)

  const title = (parsed.subject ?? '').trim().slice(0, 500) || 'Untitled draft from email'
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } })
  const contentItemId = ulid()
  const slug = await uniqueContentSlug(db, siteId, title)

  const itemInsert = db.insert(contentItems).values({
    id: contentItemId,
    siteId,
    typeId: type.id,
    authorId: ownerId,
    title,
    slug,
    status: 'draft',
    visibility: 'public',
    content: { type: 'doc', content: body },
    locale: site?.locale || 'en',
  })
  const messageInsert = db.insert(emailMessages).values({
    id: ulid(),
    siteId,
    mailboxId: mailbox.id,
    threadId: contentItemId,
    direction: 'inbound',
    messageId,
    fromAddress: ownerEmail,
    toAddress: envelopeTo,
    subject: title,
    snippet: makeSnippet(parsed.text ?? stripHtmlToPlainText(parsed.html ?? '')),
    auth,
    status: 'read',
    size: input.raw.byteLength,
    contentItemId,
  })
  const auditInsert = buildAuditLogInsert(event, ownerId, {
    action: 'create',
    resource: 'content_item',
    resourceId: contentItemId,
    after: { source: 'email', title },
  })
  await batchWithAudit(db, [itemInsert, messageInsert], auditInsert)

  await sendNotification({
    siteId,
    userId: ownerId,
    type: 'content.post_by_email',
    title: `Draft created: ${title}`,
    body: 'Your email was saved as a draft. Review and publish it from the editor.',
    data: { contentItemId },
    sendEmailNotification: true,
    pushUrl: `/admin/content/${contentItemId}`,
    actionLabel: 'Open draft',
  }, event).catch(err => console.error('[inbound-email] Notify failed:', err))
}
