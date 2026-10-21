import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { getContentTypeBySlugOrThrow } from '../../../utils/content-queries'
import { parsePagination } from '../../../utils/pagination'
import { isSiteTeamMember } from '../../../utils/permissions'
import { paginate, countRows } from '@nuxflow/db/queries'
import { contentItems, contentTaxonomyTerms, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq, desc, gt, inArray } from 'drizzle-orm'

// updatedAfter round-trips contentItems.updatedAt, which is always written as SQLite's
// datetime('now') — space-separated "YYYY-MM-DD HH:MM:SS", not ISO-8601 — so an offline/
// delta-sync client that echoes a server-returned timestamp back here (the endpoint's
// documented use case) must not be rejected by a strict z.string().datetime() check.
// Accepts either that stored format or a client-authored ISO-8601 string.
const updatedAfterSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/,
  'Expected "YYYY-MM-DD HH:MM:SS" or ISO-8601',
)

const querySchema = z.object({
  type: z.string().optional(),
  status: z.enum(['draft', 'review', 'published', 'scheduled', 'archived']).optional(),
  locale: z.string().optional(),
  updatedAfter: updatedAfterSchema.optional(),
  // Only items tagged with this taxonomy term id (the term itself, not its sub-terms —
  // an editor filtering the admin list wants exactly what's assigned).
  term: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  // Parsed once and reused for both schema validation and pagination — the Zod schema
  // only covers the fields this route branches on (type/status/locale/updatedAfter) and
  // strips unrecognized keys, so page/limit are read from this same raw object via
  // parsePagination, which already has its own lenient Number()-coercion + default/clamp
  // logic and doesn't need Zod validation on top of it.
  const rawQuery = getQuery(event)
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) validationError('Validation error', parsed.error.flatten())
  const query = parsed.data
  const typeSlug = query.type || 'page'

  // A caller may only see non-published content (or filter by status at all) if they
  // are on THIS site's team — not merely "has some valid session or API key", and not a
  // `member` (a site visitor who registered or subscribed). User accounts/sessions are
  // global across this multi-tenant install, so a bare session check would let anyone
  // with an account on ANY site list another tenant's drafts. API-key requests are
  // already scoped: 03.api-key-auth.ts only sets apiKeyUserId for a live team role on
  // this exact site.
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  const isTeam = Boolean(apiKeyUserId) || (await isSiteTeamMember(event))

  const type = await getContentTypeBySlugOrThrow(db, siteId, typeSlug, `Content type "${typeSlug}" not found`)

  const conditions = [eq(contentItems.siteId, siteId), eq(contentItems.typeId, type.id)]

  // Everyone else (members, unauthenticated callers) sees only published PUBLIC content —
  // a members-only, password-protected or private item's title and slug are not theirs
  // to list (a slug like "smith-wedding" gives a client gallery away).
  if (!isTeam) {
    conditions.push(eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public'))
  } else if (query.status) {
    conditions.push(eq(contentItems.status, query.status))
  }

  // Filter by locale
  if (query.locale) {
    conditions.push(eq(contentItems.locale, query.locale))
  }

  if (query.term) {
    // Scoped through the term's taxonomy to this site, so a foreign term id matches nothing.
    conditions.push(inArray(contentItems.id, db.select({ id: contentTaxonomyTerms.contentItemId })
      .from(contentTaxonomyTerms)
      .innerJoin(taxonomyTerms, eq(taxonomyTerms.id, contentTaxonomyTerms.termId))
      .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
      .where(and(eq(contentTaxonomyTerms.termId, query.term), eq(taxonomies.siteId, siteId)))))
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
