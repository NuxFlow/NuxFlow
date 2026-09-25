import { z } from 'zod'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { emailMessages, mailboxes, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { parseBody } from '../../../../utils/validate'
import { getEmailMessageOrThrow } from '../../../../utils/inbox'
import { loadEmailConfig, sendEmailWithConfig, escapeHtml } from '../../../../utils/email'
import { parseRecipient, makeSnippet, CATCH_ALL_LOCAL_PART } from '../../../../utils/inbound-email'
import { writeAuditLog } from '../../../../utils/audit'
import { rateLimit } from '../../../../utils/rate-limit'
import { errorMessage } from '../../../../utils/errors'
import { created } from '../../../../utils/response'

const bodySchema = z.object({
  body: z.string().trim().min(1).max(50_000),
  /** Include the original message, quoted, under the reply. */
  quote: z.boolean().default(true),
})

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject || '(no subject)'}`
}

function textToHtml(text: string): string {
  return text.split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Replies to an inbox message by email. Which address it's sent from depends on where
 * the original arrived:
 *  - on the site's own domain → from that same address (`contact@acme.com`), so the
 *    conversation stays on one address. Needs that domain onboarded for *sending* too
 *    (Email Routing and Email Sending are enabled separately).
 *  - on the platform domain → from the site's normal From address, with Reply-To set to
 *    the platform alias so the customer's answer comes back into this inbox.
 * The reply is stored in the same thread as an outbound message.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { keyPrefix: `inbox-reply:${userId}`, limit: 60, windowMs: 3_600_000 })
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const original = await getEmailMessageOrThrow(db, siteId, id)
  if (original.direction !== 'inbound' || original.contentItemId) badRequest('Only received messages can be replied to')

  const [mailbox, site] = await Promise.all([
    original.mailboxId ? db.query.mailboxes.findFirst({ where: eq(mailboxes.id, original.mailboxId) }) : Promise.resolve(undefined),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
  ])
  const config = await loadEmailConfig(event)

  const siteDomain = (site?.domain ?? '').replace(/^www\./, '').split(':')[0]!.toLowerCase()
  const arrivedAt = parseRecipient(original.toAddress)
  let from: string | undefined
  let replyTo: string | undefined
  if (arrivedAt && arrivedAt.domain === siteDomain) {
    // Reply from the address the customer wrote to (sub-address tag dropped). For a
    // catch-all mailbox that's whatever local part they used.
    const local = mailbox && mailbox.localPart !== CATCH_ALL_LOCAL_PART ? mailbox.localPart : arrivedAt.local
    from = `${local}@${siteDomain}`
  }
  else {
    replyTo = original.toAddress
  }

  const headers: Record<string, string> = {}
  if (original.messageId) {
    headers['In-Reply-To'] = original.messageId
    headers.References = [original.references, original.messageId].filter(Boolean).join(' ').slice(-1900)
  }

  let text = body.body
  let html = textToHtml(body.body)
  if (body.quote) {
    const who = original.fromName ? `${original.fromName} <${original.fromAddress}>` : original.fromAddress
    const quoted = (original.textBody ?? '').split(/\r?\n/).slice(0, 80)
    text += `\n\nOn ${original.createdAt} UTC, ${who} wrote:\n${quoted.map(l => `> ${l}`).join('\n')}`
    html += `<p style="color:#6b7280">On ${escapeHtml(original.createdAt)} UTC, ${escapeHtml(who)} wrote:</p><blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:3px solid #d1d5db;color:#6b7280">${textToHtml(quoted.join('\n'))}</blockquote>`
  }

  const subject = replySubject(original.subject)
  let messageId: string | undefined
  try {
    ;({ messageId } = await sendEmailWithConfig(config, {
      to: original.fromAddress,
      subject,
      html,
      text,
      from,
      replyTo,
      headers,
      category: 'inbox_reply',
    }, event))
  }
  catch (err) {
    throw createError({ statusCode: 502, message: `The reply could not be sent: ${errorMessage(err, String(err))}` })
  }

  const replyId = ulid()
  await db.insert(emailMessages).values({
    id: replyId,
    siteId,
    mailboxId: original.mailboxId,
    threadId: original.threadId,
    direction: 'outbound',
    // Stored in angle-bracket form so a customer's In-Reply-To matches it on the way back.
    messageId: messageId ? (messageId.startsWith('<') ? messageId : `<${messageId}>`) : null,
    inReplyTo: original.messageId,
    fromAddress: from ?? config.fromAddress ?? `noreply@${config.domain}`,
    fromName: config.fromName ?? null,
    toAddress: original.fromAddress,
    subject,
    snippet: makeSnippet(body.body),
    textBody: text,
    htmlBody: html,
    status: 'read',
    sentByUserId: userId,
  })
  if (original.status === 'new') {
    await db.update(emailMessages).set({ status: 'read' }).where(eq(emailMessages.id, id))
  }

  await writeAuditLog(event, userId, {
    action: 'create',
    resource: 'email_message',
    resourceId: replyId,
    after: { to: original.fromAddress, subject, inReplyTo: id },
  })

  return created(event, { id: replyId })
})
