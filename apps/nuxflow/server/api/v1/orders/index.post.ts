import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { refundOrder } from '../../../utils/order-admin'

const bodySchema = z.discriminatedUnion('action', [
  // Money back, all of what's left (no amount) or part of it, in minor units.
  z.object({
    action: z.literal('refund'),
    id: z.string().min(1).max(64),
    amountMinor: z.number().int().min(1).optional(),
    reason: z.string().trim().max(500).optional(),
  }),
])

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const body = await parseBody(event, bodySchema)
  const order = await refundOrder(event, body.id, { amountMinor: body.amountMinor, reason: body.reason, userId })
  await writeAuditLog(event, userId, {
    action: 'refund',
    resource: 'order',
    resourceId: order.id,
    after: { amountMinor: body.amountMinor ?? 'remaining', refundedMinor: order.refundedMinor, status: order.status },
  })
  return { order }
})
