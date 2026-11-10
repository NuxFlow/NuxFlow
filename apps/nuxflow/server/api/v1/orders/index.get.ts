import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { parsePagination } from '../../../utils/pagination'
import { getOrderDetail, listOrders, refundConsequences } from '../../../utils/order-admin'

const querySchema = z.object({
  // One order, with its lines and refunds.
  id: z.string().min(1).max(64).optional(),
  filter: z.enum(['sales', 'all', 'pending', 'paid', 'partially_refunded', 'refunded', 'expired', 'cancelled']).default('sales'),
  kind: z.enum(['product', 'booking', 'pass', 'tier']).optional(),
  // Part of a name or address, or an order number.
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

// Admin → Orders. Customers' names and addresses, and the site's takings: admins only.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const query = parseQuery(event, querySchema)
  if (query.id) {
    const detail = await getOrderDetail(event, query.id)
    return { ...detail, refundNotes: refundConsequences(detail.lines) }
  }
  const { page, perPage, offset } = parsePagination(query, 50, 200)
  const result = await listOrders(event, { filter: query.filter, kind: query.kind, search: query.search, limit: perPage, offset })
  return { ...result, page, perPage }
})
