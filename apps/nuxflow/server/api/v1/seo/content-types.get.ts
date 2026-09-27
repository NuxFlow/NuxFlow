import { contentTypes } from '@nuxflow/db/schema'
import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

/** Content types for the SEO page's "hide these types from search engines" picker. */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const siteId = event.context.siteId as string
  const types = await useDb(event).query.contentTypes.findMany({
    where: eq(contentTypes.siteId, siteId),
    columns: { slug: true, name: true },
    orderBy: [asc(contentTypes.name)],
  })
  return { types }
})
