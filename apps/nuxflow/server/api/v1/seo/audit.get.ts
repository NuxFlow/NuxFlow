import { contentItems, contentTypes, sites } from '@nuxflow/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getSeoSettings, publicPathForItem, robotsSaysNoindex } from '../../../utils/seo'
import { buildSeoAudit, type AuditItemInput } from '../../../utils/seo-audit'

// Newest published items checked per run — enough for any realistic editorial backlog
// while keeping one request's D1 read bounded (content bodies are never selected).
const AUDIT_ITEM_CAP = 2000

/**
 * Admin → SEO → Audit: per-page problems (missing/too-long/duplicate titles and
 * descriptions, no share image, noindexed) plus site-level configuration gaps.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [seo, site, types, rows] = await Promise.all([
    getSeoSettings(db, siteId),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } }),
    db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId), columns: { id: true, slug: true, singularName: true } }),
    db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published')),
      columns: {
        id: true, title: true, slug: true, locale: true, sourceItemId: true, typeId: true, visibility: true,
        seoTitle: true, seoDescription: true, excerpt: true, ogImage: true, metaRobots: true, canonicalUrl: true,
      },
      orderBy: [desc(contentItems.publishedAt)],
      limit: AUDIT_ITEM_CAP,
    }),
  ])
  const typeById = new Map(types.map(t => [t.id, t]))
  const slugById = new Map(rows.map(r => [r.id, r.slug]))
  const defaultLocale = site?.locale || 'en'

  const items: AuditItemInput[] = rows.map((r) => {
    const type = r.typeId ? typeById.get(r.typeId) : undefined
    return {
      id: r.id,
      title: r.title,
      path: publicPathForItem({ slug: r.slug, locale: r.locale, sourceSlug: r.sourceItemId ? slugById.get(r.sourceItemId) ?? null : null }, defaultLocale),
      typeName: type?.singularName ?? null,
      isPublic: r.visibility === 'public',
      seoTitle: r.seoTitle,
      description: r.seoDescription || r.excerpt,
      hasOwnDescription: Boolean(r.seoDescription),
      ogImage: r.ogImage,
      noindex: robotsSaysNoindex(r.metaRobots) || Boolean(type && !r.metaRobots && seo.noindexContentTypes.includes(type.slug)),
      canonicalUrl: r.canonicalUrl,
    }
  })

  return buildSeoAudit(items, seo, { truncated: rows.length >= AUDIT_ITEM_CAP })
})
