import { z } from 'zod'
import { and, desc, eq, like, or } from 'drizzle-orm'
import { classPasses, classPassHoldings } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import type { AdminClassPass } from '../../../../shared/lib/membership-types'

const querySchema = z.object({
  // Part of a holder's name or address.
  search: z.string().trim().max(200).optional(),
})

// Admin → Class passes: what's on sale, and who holds what. The holders are personal data.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { search } = parseQuery(event, querySchema)
  const pattern = search ? `%${search.replace(/[%_]/g, '')}%` : null

  const [passes, holdings] = await Promise.all([
    db.query.classPasses.findMany({ where: eq(classPasses.siteId, siteId), orderBy: [desc(classPasses.createdAt)] }),
    db.query.classPassHoldings.findMany({
      where: and(
        eq(classPassHoldings.siteId, siteId),
        pattern ? or(like(classPassHoldings.email, pattern), like(classPassHoldings.name, pattern)) : undefined,
      ),
      orderBy: [desc(classPassHoldings.createdAt)],
      limit: 500,
    }),
  ])
  return { passes: passes satisfies AdminClassPass[], holdings }
})
