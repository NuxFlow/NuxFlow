import { useDb } from '../../../utils/db'
import { getContentTypeBySlugOrThrow } from '../../../utils/content-queries'
import { parsePagination } from '../../../utils/pagination'
import { getUserSiteRole, hasSuperAdminRole } from '../../../utils/permissions'
import { paginate, countRows } from '@nuxflow/db/queries'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, desc, gt } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const typeSlug = (query.type as string) || 'page'

  // A caller may only see non-published content (or filter by status at all) if they
  // are an actual member of THIS site — not merely "has some valid session or API
  // key." User accounts/sessions are global across this multi-tenant install, so a
  // bare session check would let anyone with an account on ANY site (or a self-
  // registered account where public registration is enabled) list another tenant's
  // drafts/unpublished/scheduled content by hitting that tenant's domain directly.
  // API-key requests are already scoped: 03.api-key-auth.ts only sets apiKeyUserId
  // when a live user_site_roles row exists for this exact site.
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  let isSiteMember = Boolean(apiKeyUserId)
  if (!isSiteMember) {
    const session = await getAuthSession(event)
    if (session) {
      const roleRow = await getUserSiteRole(db, session.user.id, siteId)
      isSiteMember = Boolean(roleRow) || (await hasSuperAdminRole(db, session.user.id))
    }
  }

  const type = await getContentTypeBySlugOrThrow(db, siteId, typeSlug, `Content type "${typeSlug}" not found`)

  const conditions = [eq(contentItems.siteId, siteId), eq(contentItems.typeId, type.id)]

  // Non-members (including unauthenticated callers) see only published content
  if (!isSiteMember) {
    conditions.push(eq(contentItems.status, 'published'))
  } else if (query.status) {
    conditions.push(eq(contentItems.status, query.status as 'draft' | 'review' | 'published' | 'scheduled' | 'archived'))
  }

  // Filter by locale
  if (query.locale) {
    conditions.push(eq(contentItems.locale, query.locale as string))
  }

  // Delta sync: return only items modified after a given timestamp.
  // Used by offline clients on reconnect to fetch only what changed.
  // Hits idx_content_items_site_updated (site_id, updated_at) index.
  if (query.updatedAfter) {
    conditions.push(gt(contentItems.updatedAt, query.updatedAfter as string))
  }

  // Delta sync clients (updatedAfter) rely on getting every changed row back
  // in one response, so pagination — and the total count that goes with it —
  // only applies to the normal listing case.
  const { page, limit, offset } = parsePagination(query, 50)
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
