import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  interval: z.enum(['month', 'year', 'one_time']).optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const tier = await db.query.membershipTiers.findFirst({
    where: and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)),
    columns: { id: true },
  })
  if (!tier) throw createError({ statusCode: 404, message: 'Membership tier not found' })

  await db.update(membershipTiers)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)))

  const updated = await db.query.membershipTiers.findFirst({
    where: (t, { eq: eq_ }) => eq_(t.id, id),
  })
  return updated
})
