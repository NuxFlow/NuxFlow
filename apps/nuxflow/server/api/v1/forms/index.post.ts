import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { forms } from '@nuxflow/db/schema'
import type { FormField, ConditionalLogic } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  fields: z.array(z.unknown()).default([]),
  logic: z.array(z.unknown()).default([]),
  status: z.enum(['active', 'draft', 'closed']).default('draft'),
  redirectUrl: z.string().url().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  const formInsert = db.insert(forms).values({
    id,
    siteId,
    ...body,
    fields: body.fields as FormField[],
    logic: body.logic as ConditionalLogic[],
  })

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'create', resource: 'form', resourceId: id, after: body })
  await db.batch(auditInsert ? [formInsert, auditInsert] : [formInsert])

  return created(event, { id })
})
