import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { classPasses, classPassHoldings } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { refundUnusedCredits } from '../../../utils/class-passes'

const bodySchema = z.discriminatedUnion('action', [
  // Changes to what's on sale. People who already bought keep what they bought.
  z.object({
    action: z.literal('update'),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullish(),
    credits: z.number().int().min(1).max(1000).optional(),
    price: z.number().min(0.5).max(999_999).optional(),
    currency: z.string().regex(/^[a-z]{3}$/i, 'Use a three-letter currency code, such as GBP').transform(c => c.toUpperCase()).optional(),
    validDays: z.number().int().min(1).max(3650).nullish(),
    isActive: z.boolean().optional(),
  }),
  // On someone's pass (`id` is the holding's): money back for the credits they haven't used.
  z.object({ action: z.literal('refund-holding') }),
])

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  if (body.action === 'refund-holding') {
    const holding = await db.query.classPassHoldings.findFirst({ where: and(eq(classPassHoldings.id, id), eq(classPassHoldings.siteId, siteId)) })
    if (!holding) notFound('That pass was not found.')
    const result = await refundUnusedCredits(event, holding)
    await writeAuditLog(event, userId, { action: 'update', resource: 'class_pass_holding', resourceId: id, after: { status: 'refunded', ...result } })
    return result
  }

  const { action: _action, ...fields } = body
  const [row] = await db.update(classPasses)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(and(eq(classPasses.id, id), eq(classPasses.siteId, siteId)))
    .returning({ id: classPasses.id })
  if (!row) notFound('That pass was not found.')
  await writeAuditLog(event, userId, { action: 'update', resource: 'class_pass', resourceId: id, after: fields })
  return { id }
})
