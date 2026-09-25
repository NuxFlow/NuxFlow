import { generateText } from 'ai'
import { and, asc, eq } from 'drizzle-orm'
import { emailMessages, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getEmailMessageOrThrow } from '../../../../utils/inbox'
import { requireAiSdkModel, callAiOrThrow } from '../../../../utils/ai-sdk'
import { rateLimit } from '../../../../utils/rate-limit'

const SYSTEM = `You draft email replies for the team behind a website. Write a concise, friendly, professional reply to the customer's latest message, using the conversation so far for context.
- Reply in the customer's language.
- Plain text only: no subject line, no markdown, no placeholders like [Name] unless a detail is genuinely unknown.
- Never invent facts, prices, dates, or commitments. Where the team must supply a specific detail, leave a short bracketed note for them, e.g. [confirm delivery date].
- Sign off with the site's name.`

/**
 * An AI-drafted reply for the editor to review and edit — never sent automatically. The
 * text only ever lands in the reply box of the admin UI.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { keyPrefix: `inbox-suggest:${userId}`, limit: 30, windowMs: 3_600_000 })
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const message = await getEmailMessageOrThrow(db, siteId, id)
  const [thread, site] = await Promise.all([
    db.query.emailMessages.findMany({
      where: and(eq(emailMessages.siteId, siteId), eq(emailMessages.threadId, message.threadId)),
      columns: { direction: true, fromAddress: true, textBody: true, createdAt: true },
      orderBy: [asc(emailMessages.createdAt)],
      limit: 20,
    }),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true } }),
  ])

  const conversation = thread.map(m =>
    `--- ${m.direction === 'inbound' ? `Customer (${m.fromAddress})` : 'Our team'}, ${m.createdAt} ---\n${(m.textBody ?? '').slice(0, 3000)}`,
  ).join('\n\n')

  const model = await requireAiSdkModel(event, 'smart', { userId })
  const { text } = await callAiOrThrow(() => generateText({
    model,
    system: SYSTEM,
    prompt: `Site name: ${site?.name ?? 'our team'}\nSubject: ${message.subject}\n\n${conversation.slice(-12_000)}\n\nWrite the reply to the customer's latest message.`,
    maxOutputTokens: 800,
  }))

  return { suggestion: text.trim() }
})
