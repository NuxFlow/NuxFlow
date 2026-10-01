import { useDb, useReplicaDb, type Db } from '../../../utils/db'
import { trackPageView } from '../../../utils/analytics'
import { contentItems, contentTypes, sites, users } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { withEdgeCache } from '../../../utils/edge-cache'
import { findRedirect } from '../../../utils/redirect-cache'
import { findPreviewItem } from '../../../utils/preview'
import { findPublishedPage, parseLocalePath } from '../../../utils/public-page'
import { effectiveItemRobots, getSeoSettings, publicPathForItem } from '../../../utils/seo'
import { getPublicItemTerms, termArchivePath } from '../../../utils/taxonomy'
import { checkContentAccess } from '../../../utils/content-access'

type ContentItemRow = typeof contentItems.$inferSelect

export default defineEventHandler(async (event) => {
  // Redirect/locale/content lookups below are anonymous, read-only, and already
  // edge-cached (or gate-checked fresh regardless, see checkContentAccess) — safe to read
  // from a D1 read replica when one is enabled (see the "D1 read replication" note on
  // useReplicaDb in server/utils/db.ts). checkContentAccess's own subscription check
  // deliberately resolves its own primary-DB instance below rather than reusing this one,
  // since membership access needs read-after-write freshness a replica can't guarantee.
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const slug = getRouterParam(event, 'slug')!

  // Check redirects first
  const redirect = await findRedirect(db, siteId, `/${slug}`)
  if (redirect) {
    if (redirect.statusCode === 410) throw createError({ statusCode: 410, statusMessage: 'Gone' })
    return sendRedirect(event, redirect.to, redirect.statusCode)
  }

  // Locale-prefixed URLs ("es/my-page", or just "es") resolve to a linked translation —
  // see parseLocalePath/findPublishedPage in utils/public-page.ts (shared with the
  // Markdown alternate in middleware/06.markdown.ts so both resolve identically).
  const { locale: requestedLocale, slug: actualSlug } = await parseLocalePath(db, siteId, slug)

  // Draft preview (a link from the editor's "Preview link" button — see
  // api/preview/[token].get.ts): a valid token for exactly this slug serves that item
  // regardless of status. Checked before the published lookup so previewing an edited
  // draft never falls back to something else. Never cached, never indexed, not counted
  // as a page view, and not membership-gated — the token itself is the authorization.
  const previewItem = await findPreviewItem(event, useDb(event), siteId, actualSlug)
  if (previewItem) {
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Robots-Tag', 'noindex')
    const response = await assemblePageResponse(useDb(event), previewItem, siteId)
    return { ...response, robots: 'noindex,nofollow' }
  }

  const page = await findPublishedPage(db, siteId, actualSlug, requestedLocale)

  if (!page) throw notFound('Not found')

  const gate = await checkContentAccess(event, { visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate?.blocked) {
    throw createError({
      statusCode: 402,
      data: { gated: true, requiredTier: gate.requiredTier, tiers: gate.tiers },
    })
  }

  trackPageView(event, { siteId, slug })

  // Member-gated pages that passed the gate are per-caller (the response depends on the
  // requester's session/subscription, not just the URL), so they must never be shared via
  // the edge cache — gating is always evaluated fresh above, on every request, before the
  // cache is ever consulted. Only genuinely public pages are eligible for the edge cache below.
  const isGated = page.visibility === 'members'
  if (isGated) {
    setHeader(event, 'Cache-Control', 'private, no-store')
    return assemblePageResponse(db, page, siteId)
  }

  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  return withEdgeCache(event, 3600, () => assemblePageResponse(db, page, siteId))
})

async function assemblePageResponse(db: Db, page: ContentItemRow, siteId: string) {
  // Content type, author, source-page, site-locale, and SEO-settings lookups are all
  // independent of each other (they only need `page`, already resolved above), so run
  // them as one round trip each in parallel instead of sequentially.
  const [type, authorUser, sourcePageResolved, site, seo, ownTerms] = await Promise.all([
    page.typeId
      ? db.query.contentTypes.findFirst({
          where: eq(contentTypes.id, page.typeId),
          columns: { hasComments: true, slug: true, name: true, singularName: true },
        })
      : Promise.resolve(null),
    page.authorId
      ? db.query.users.findFirst({
          where: eq(users.id, page.authorId),
          columns: { name: true, image: true },
        })
      : Promise.resolve(null),
    // Scoped to this site and to published items: this feeds the public language switcher,
    // so it must never reveal the slug of another tenant's item or of an unpublished one.
    page.sourceItemId
      ? db.query.contentItems.findFirst({
          where: and(
            eq(contentItems.id, page.sourceItemId),
            eq(contentItems.siteId, siteId),
            eq(contentItems.status, 'published'),
          ),
          columns: { locale: true, slug: true },
        })
      : Promise.resolve(null),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } }),
    getSeoSettings(db, siteId),
    getPublicItemTerms(db, page.id),
  ])
  const defaultLocale = site?.locale || 'en'

  // A translation that hasn't been tagged itself shows its original's terms — the
  // archives it links to are shared across languages.
  const termRows = ownTerms.length === 0 && page.sourceItemId && sourcePageResolved
    ? await getPublicItemTerms(db, page.sourceItemId)
    : ownTerms
  const terms = termRows.map(t => ({ ...t, path: termArchivePath(t.taxonomySlug, t.termSlug) }))

  // Per-item override takes precedence; null means "inherit from content type"
  const hasComments = page.allowComments !== null && page.allowComments !== undefined
    ? page.allowComments
    : (type?.hasComments ?? false)

  const author: { name: string; image: string | null } | null = authorUser ?? null

  // Resolve available translations for the switcher
  const availableLocales: Array<{ locale: string; slug: string; rawSlug: string }> = []
  const sourceId = page.sourceItemId || page.id
  const sourcePage = page.sourceItemId
    ? sourcePageResolved
    : page

  if (sourcePage) {
    availableLocales.push({
      locale: sourcePage.locale || defaultLocale,
      slug: sourcePage.slug,
      rawSlug: sourcePage.slug,
    })

    const siblings = await db.query.contentItems.findMany({
      where: and(
        eq(contentItems.siteId, siteId),
        eq(contentItems.sourceItemId, sourceId),
        eq(contentItems.status, 'published'),
      ),
      columns: { locale: true, slug: true },
    })

    siblings.forEach((s) => {
      availableLocales.push({
        locale: s.locale,
        slug: sourcePage.slug, // clean prefix routing uses parent slug
        rawSlug: s.slug,
      })
    })
  }

  // The item's own public path (translations live at /{locale}/{source slug}, the
  // homepage at /) and its hreflang alternates — computed here so the page, the sitemap,
  // and the Markdown alternate all agree on one URL per item.
  const path = publicPathForItem({ slug: page.slug, locale: page.locale, sourceSlug: sourcePage && sourcePage !== page ? sourcePage.slug : null }, defaultLocale)
  const alternates = availableLocales.length > 1
    ? availableLocales.map(l => ({
        locale: l.locale,
        path: publicPathForItem({ slug: l.rawSlug, locale: l.locale, sourceSlug: l.rawSlug === l.slug ? null : l.slug }, defaultLocale),
      }))
    : []

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    path,
    locale: page.locale || defaultLocale,
    defaultLocale,
    content: page.content,
    excerpt: page.excerpt,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImage: page.ogImage,
    canonicalUrl: page.canonicalUrl,
    metaRobots: page.metaRobots,
    // Effective robots directive: the item's own override, else the site's per-content-
    // type default, else (site-wide noindex) noindex — null means index,follow.
    robots: effectiveItemRobots({ metaRobots: page.metaRobots, typeSlug: type?.slug }, seo),
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
    type: type ? { slug: type.slug, name: type.singularName || type.name } : null,
    event: page.eventStartAt
      ? {
          startAt: page.eventStartAt,
          endAt: page.eventEndAt,
          allDay: page.eventAllDay,
          location: page.eventLocation,
          url: page.eventUrl,
        }
      : null,
    hasComments,
    author,
    terms,
    availableLocales,
    alternates,
  }
}
