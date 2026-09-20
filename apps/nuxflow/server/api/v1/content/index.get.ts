import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { getContentTypeBySlugOrThrow } from '../../../utils/content-queries'
import { parsePagination } from '../../../utils/pagination'
import { parseQuery } from '../../../utils/validate'
import { isSiteMember } from '../../../utils/permissions'
import { paginate, countRows } from '@nuxflow/db/queries'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, desc, gt } from 'drizzle-orm'

const querySchema = z.object({
  type: z.string().optional(),
  status: z.enum(['draft', 'review', 'published', 'scheduled', 'archived']).optional(),
  locale: z.string().optional(),
  updatedAfter: z.string().datetime().optional(),
})

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  // parseQuery's Zod schema only covers the fields this route actually branches
  // on (type/status/locale/updatedAfter) — it strips unrecognized keys, so page/
  // limit are read from the raw query separately below via parsePagination,
  // which already has its own lenient Number()-coercion + default/clamp logic
  // and doesn't need Zod validation on top of it.
  const rawQuery = getQuery(event)
  const query = parseQuery(event, querySchema)
  const typeSlug = query.type || 'page'

  // A caller may only see non-published content (or filter by status at all) if they
  // are an actual member of THIS site — not merely "has some valid session or API
  // key." User accounts/sessions are global across this multi-tenant install, so a
  // bare session check would let anyone with an account on ANY site (or a self-
  // registered account where public registration is enabled) list another tenant's
  // drafts/unpublished/scheduled content by hitting that tenant's domain directly.
  // API-key requests are already scoped: 03.api-key-auth.ts only sets apiKeyUserId
  // when a live user_site_roles row exists for this exact site.
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  const isMember = Boolean(apiKeyUserId) || (await isSiteMember(event))

  const type = await getContentTypeBySlugOrThrow(db, siteId, typeSlug, `Content type "${typeSlug}" not found`)

  const conditions = [eq(contentItems.siteId, siteId), eq(contentItems.typeId, type.id)]

  // Non-members (including unauthenticated callers) see only published content
  if (!isMember) {
    conditions.push(eq(contentItems.status, 'published'))
  } else if (query.status) {
    conditions.push(eq(contentItems.status, query.status))
  }

  // Filter by locale
  if (query.locale) {
    conditions.push(eq(contentItems.locale, query.locale))
  }

  // Delta sync: return only items modified after a given timestamp.
  // Used by offline clients on reconnect to fetch only what changed.
  // Hits idx_content_items_site_updated (site_id, updated_at) index.
  if (query.updatedAfter) {
    conditions.push(gt(contentItems.updatedAt, query.updatedAfter))
  }

  // Delta sync clients (updatedAfter) rely on getting every changed row back
  // in one response, so pagination — and the total count that goes with it —
  // only applies to the normal listing case.
  const { page, limit, offset } = parsePagination(rawQuery, 50)
  const where = and(...conditions)
  const columns = {
    id: true, title: true, slug: true, status: true, publishedAt: true, updatedAt: true, authorId: true, version: true, locale: true, sourceItemId: true,
  } as const

  if (query.updatedAfter) {
    const items = await db.query.contentItems.findMany({
      where, orderBy: [desc(contentItems.updatedAt)], columns,
    })
    return { items, type, page, limit }
  }

  const { items, total } = await paginate(
    countRows(db, contentItems, where),
    () => db.query.contentItems.findMany({ where, orderBy: [desc(contentItems.updatedAt)], columns, limit, offset }),
  )

  return { items, type, page, limit, total }
})
