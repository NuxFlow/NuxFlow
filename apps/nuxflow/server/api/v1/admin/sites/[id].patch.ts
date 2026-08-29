import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { clearSiteCache } from '../../../../middleware/02.multi-site'
import { sites } from '@nuxflow/db/schema'
import { eq, sql } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().optional(),
  status: z.enum(['active', 'maintenance', 'suspended']).optional(),
  locale: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  await db.update(sites).set({ ...body, updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, id))
  // Domain (or status) may have changed — drop the whole cache rather than
  // tracking the old domain key, since a rename means the old key is now stale too.
  clearSiteCache()
  return { id }
})
