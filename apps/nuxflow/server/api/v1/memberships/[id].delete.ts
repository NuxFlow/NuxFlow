import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const tier = await db.query.membershipTiers.findFirst({
    where: and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)),
    columns: { id: true },
  })
  if (!tier) throw createError({ statusCode: 404, message: 'Membership tier not found' })

  await db.delete(membershipTiers).where(and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)))

  return { success: true }
})
