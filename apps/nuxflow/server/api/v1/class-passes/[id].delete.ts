import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { classPasses, classPassHoldings } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { noContent } from '../../../utils/response'
import { creditsLeft } from '../../../utils/class-passes'

const querySchema = z.object({
  // A pass on sale (the default), or someone's pass being erased from the records.
  kind: z.enum(['pass', 'holding']).default('pass'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const { kind } = parseQuery(event, querySchema)

  if (kind === 'holding') {
    const holding = await db.query.classPassHoldings.findFirst({ where: and(eq(classPassHoldings.id, id), eq(classPassHoldings.siteId, siteId)) })
    if (!holding) notFound('That pass was not found.')
    // Otherwise the record of what they've paid for and not had goes with it.
    if (holding.status === 'active' && creditsLeft(holding) > 0 && holding.amountPaid > 0) {
      conflict('This pass still has unused credits. Refund them first.')
    }
    await db.delete(classPassHoldings).where(and(eq(classPassHoldings.id, id), eq(classPassHoldings.siteId, siteId)))
    await writeAuditLog(event, userId, { action: 'delete', resource: 'class_pass_holding', resourceId: id })
    return noContent(event)
  }

  // Taking a pass off sale doesn't touch what people already bought: holdings keep a copy.
  const [row] = await db.delete(classPasses)
    .where(and(eq(classPasses.id, id), eq(classPasses.siteId, siteId)))
    .returning({ id: classPasses.id })
  if (!row) notFound('That pass was not found.')
  await writeAuditLog(event, userId, { action: 'delete', resource: 'class_pass', resourceId: id })
  return noContent(event)
})
