import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
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
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const id = ulid()
  await db.insert(forms).values({
    id,
    siteId,
    ...body,
    fields: body.fields as FormField[],
    logic: body.logic as ConditionalLogic[],
  })
  setResponseStatus(event, 201)
  return { id }
})
