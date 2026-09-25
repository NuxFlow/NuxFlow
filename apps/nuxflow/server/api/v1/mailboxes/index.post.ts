import { z } from 'zod'
import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { mailboxes } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parseBody } from '../../../utils/validate'
import { isValidMailboxLocalPart } from '../../../utils/inbox'
import { writeAuditLog } from '../../../utils/audit'
import { created, conflict } from '../../../utils/response'

const bodySchema = z.object({
  localPart: z.string().trim().toLowerCase().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  forwardTo: z.email().max(254).nullish(),
  notify: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  if (!isValidMailboxLocalPart(body.localPart)) {
    validationError('Use letters, numbers, dots, dashes or underscores (or * for a catch-all). "post-…" and addresses like postmaster@ are reserved.')
  }

  const existing = await db.query.mailboxes.findFirst({
    where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.localPart, body.localPart)),
    columns: { id: true },
  })
  if (existing) conflict(`${body.localPart}@ already exists`)

  const id = ulid()
  await db.insert(mailboxes).values({
    id,
    siteId,
    localPart: body.localPart,
    name: body.name,
    kind: 'inbox',
    forwardTo: body.forwardTo?.toLowerCase() || null,
    notify: body.notify,
  })
  await writeAuditLog(event, userId, { action: 'create', resource: 'mailbox', resourceId: id, after: { localPart: body.localPart } })
  return created(event, { id })
})
