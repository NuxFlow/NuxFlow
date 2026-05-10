import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { forms } from '@nuxflow/db/schema'
import type { FormField, ConditionalLogic } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).optional(),
  fields: z.array(z.unknown()).optional(),
  logic: z.array(z.unknown()).optional(),
  status: z.enum(['active', 'draft', 'closed']).optional(),
  redirectUrl: z.string().url().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const form = await db.query.forms.findFirst({
    where: and(eq(forms.id, id), eq(forms.siteId, siteId)),
  })
  if (!form) throw createError({ statusCode: 404, message: 'Form not found' })

  await db.update(forms)
    .set({
      ...body,
      fields: body.fields as FormField[] | undefined,
      logic: body.logic as ConditionalLogic[] | undefined,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(and(eq(forms.id, id), eq(forms.siteId, siteId)))

  return { id }
})
