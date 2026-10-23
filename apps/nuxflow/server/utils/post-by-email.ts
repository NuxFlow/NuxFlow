import { ulid } from 'ulid'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { contentItems, contentTypes, emailMessages, media, sites, users } from '@nuxflow/db/schema'
import { useDb } from './db'
import { sendNotification } from './notify'
import { getUserSiteRole, roleAtLeast, type Role } from './permissions'
import { uniqueContentSlug } from './content-queries'
import { htmlToTipTap, stripHtmlToPlainText, type TTNode } from './html-to-tiptap'
import { getActiveProvider } from './media-providers/index'
import { assertWithinPlan, checkPlanLimit, planLimitMessage } from './hosting-plans'
import { buildAuditLogInsert, batchWithAudit } from './audit'
import {
  MAX_ATTACHMENTS, attachmentBytes, firstMailbox, isSenderAuthenticated, makeSnippet, type InboundInput,
} from './inbound-email'

/**
 * Post by email: a `kind: 'post'` mailbox belongs to one author, and a message sent to it
 * becomes a draft in their name — only when the address, the envelope and header From
 * (both the owner's account email) and DKIM/DMARC all agree, the owner is still an author
 * here, and they're under the hourly limit. Anything else is refused with an in-app notice
 * to the owner. Reached from inbound-email.ts once the message has been accepted for the site.
 */

/** Post-by-email drafts allowed per posting address per hour. */
const POST_BY_EMAIL_HOURLY_LIMIT = 20
const DRAFT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_DRAFT_IMAGE_BYTES = 20 * 1024 * 1024

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

export async function handlePostByEmail(input: InboundInput): Promise<void> {
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
  if (!isSenderAuthenticated(auth, ownerEmail)) {
    return rejectPost(input, 'the sender could not be verified (no DMARC pass or DKIM signature from your own domain) — send from your normal mail provider rather than a script or relay', ownerId)
  }

  const roleRow = await getUserSiteRole(db, ownerId, siteId)
  if (!roleRow || !roleAtLeast(roleRow.role as Role, 'author')) {
    return rejectPost(input, 'you no longer have author access to this site', ownerId)
  }

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString().replace('T', ' ').slice(0, 19)
  const [recent] = await db.select({ n: sql<number>`count(*)` }).from(emailMessages)
    .where(and(eq(emailMessages.siteId, siteId), eq(emailMessages.mailboxId, mailbox.id), gt(emailMessages.createdAt, hourAgo)))
  if ((recent?.n ?? 0) >= POST_BY_EMAIL_HOURLY_LIMIT) {
    return rejectPost(input, `more than ${POST_BY_EMAIL_HOURLY_LIMIT} emails in the last hour`, ownerId)
  }
  const room = await checkPlanLimit(db, siteId, 'content')
  if (!room.allowed) return rejectPost(input, planLimitMessage('content', room.max ?? 0), ownerId)

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
      await assertWithinPlan(event, 'storage', bytes.byteLength, siteId)
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
        storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
        storageKey,
      })
      uploaded.add(url)
      const cid = att.contentId?.replace(/^<|>$/g, '')
      if (cid && parsed.html?.includes(`cid:${cid}`)) cidToUrl.set(cid, url)
      else trailingImages.push(url)
    }
    catch (err) {
      // The database fallback provider refuses files over 512 KB, and a full plan refuses
      // any — skip the image, keep the post.
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
