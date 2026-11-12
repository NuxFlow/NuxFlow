import { asc, count, eq } from 'drizzle-orm'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { parseFieldDefs } from '../../../../shared/lib/custom-fields'

// Admin → Content types: every type with its custom fields and how many items it has.
// Authors read it too — the content editor needs a type's fields to show them.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const [types, counts] = await Promise.all([
    db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId), orderBy: [asc(contentTypes.name)] }),
    db.select({ typeId: contentItems.typeId, n: count() }).from(contentItems).where(eq(contentItems.siteId, siteId)).groupBy(contentItems.typeId),
  ])
  const itemCount = new Map(counts.map(c => [c.typeId, Number(c.n)]))
  return {
    types: types.map(t => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      singularName: t.singularName,
      isBuiltIn: t.isBuiltIn,
      fields: parseFieldDefs(t.schema),
      itemCount: itemCount.get(t.id) ?? 0,
    })),
  }
})
