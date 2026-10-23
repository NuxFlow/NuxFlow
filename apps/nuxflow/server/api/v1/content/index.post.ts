import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole, roleAtLeast, AUTHOR_SETTABLE_STATUSES } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getContentTypeBySlugOrThrow, getContentItemOrThrow, deriveVisibilityFromSettings, archiveReplacedTranslations } from '../../../utils/content-queries'
import { created } from '../../../utils/response'
import { assertWithinPlan } from '../../../utils/hosting-plans'
import { purgeContentCache } from '../../../utils/edge-cache'
import { makePageVideosPrivate } from '../../../utils/stream'
import { indexablePathsForItems, submitToIndexNow } from '../../../utils/indexnow'
import { waitUntil } from '../../../utils/cf-env'
import { upsertContentEmbedding } from '../../../utils/embeddings'
import { assertContentSlugAvailable, getTermRefsWithAncestors, replaceContentTermsStatements, validateSiteTermIds } from '../../../utils/taxonomy'
import { queueContentHook } from '../../../utils/plugin-hooks'
import { queueContentPublishedPush } from '../../../utils/push-content'
import { contentItems } from '@nuxflow/db/schema'
import { PAGE_PASSWORD_MAX_LENGTH, resolvePageSettings } from '../../../utils/page-password'
import { sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { requireSiteId } from '../../../utils/site-context'
import { getSiteInfo } from '../../../utils/site-info'

const bodySchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(500),
  typeSlug: z.string().default('page'),
  status: z.enum(['draft', 'review', 'published', 'scheduled', 'archived']).default('draft'),
  content: z.unknown().optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  locale: z.string().max(10).optional(),
  sourceItemId: z.string().optional(),
  eventStartAt: z.string().nullish(),
  eventEndAt: z.string().nullish(),
  eventLocation: z.string().max(500).nullish(),
  eventUrl: z.string().max(2048).nullish(),
  eventAllDay: z.boolean().nullish(),
  // Taxonomy terms to assign on creation (same rules as PUT /content/:id/terms).
  termIds: z.array(z.string()).max(200).optional(),
  // Write-only password for a password-protected page — see [id].patch.ts.
  pagePassword: z.string().max(PAGE_PASSWORD_MAX_LENGTH).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { pagePassword, ...body } = await parseBody(event, bodySchema)
  body.settings = await resolvePageSettings(body.settings, null, pagePassword)

  // Only editor+ may publish/schedule directly — mirrors the identical check already
  // enforced for the MCP `update_content` tool. An `author` (the floor for content-write
  // access) is limited to draft/review, matching the review workflow those statuses exist for.
  if (body.status && !AUTHOR_SETTABLE_STATUSES.has(body.status) && !roleAtLeast(role, 'editor')) {
    forbidden('Only an editor or higher can publish, schedule, or archive content')
  }

  const type = await getContentTypeBySlugOrThrow(db, siteId, body.typeSlug, 'Content type not found')

  // A translation's source must be an item on this same site (public page translation
  // lookups trust this link).
  if (body.sourceItemId) {
    await getContentItemOrThrow(db, siteId, body.sourceItemId, 'Source item not found', { id: true })
  }

  await assertContentSlugAvailable(db, siteId, body.slug)

  const termIds = await validateSiteTermIds(db, siteId, body.termIds ?? [])

  // Resolve default site locale
  const site = await getSiteInfo(event, siteId)
  const siteLocale = site?.locale || 'en'

  await assertWithinPlan(event, 'content')
  const id = ulid()
  const itemInsert = db.insert(contentItems).values({
    id,
    siteId,
    typeId: type.id,
    authorId: userId,
    title: body.title,
    slug: body.slug,
    status: body.status,
    // Created already-published (e.g. via the API or MCP) — stamp the publish date the
    // same way PATCH does on a first publish; feeds, sitemaps, and JSON-LD rely on it.
    publishedAt: body.status === 'published' ? sql`(datetime('now'))` : null,
    visibility: deriveVisibilityFromSettings(body.settings),
    content: body.content,
    seoTitle: body.seoTitle,
    seoDescription: body.seoDescription,
    settings: body.settings,
    locale: body.locale || siteLocale,
    sourceItemId: body.sourceItemId || null,
    eventStartAt: body.eventStartAt || null,
    eventEndAt: body.eventEndAt || null,
    eventLocation: body.eventLocation || null,
    eventUrl: body.eventUrl || null,
    eventAllDay: body.eventAllDay || null,
  })

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'create', resource: 'content_item', resourceId: id })

  // Only the inserts — a brand-new item has no assignments to clear.
  await batchWithAudit(db, [itemInsert, ...replaceContentTermsStatements(db, id, termIds).slice(1)], auditInsert)

  if (body.status === 'published') {
    await archiveReplacedTranslations(db, siteId, { id, sourceItemId: body.sourceItemId, locale: body.locale })
  }

  // A brand-new slug can't already be cached, but the site-wide views (blog index,
  // sitemaps, feeds) and the archives of its terms that could now list it might be.
  await purgeContentCache(event, { published: body.status === 'published', slugs: [body.slug], taxonomyTerms: await getTermRefsWithAncestors(db, siteId, termIds) })

  // A password or members-only page makes its library videos private (signed links only).
  await makePageVideosPrivate(event, siteId, { content: body.content, visibility: deriveVisibilityFromSettings(body.settings) })

  waitUntil(event, upsertContentEmbedding(event, {
    contentItemId: id,
    siteId,
    title: body.title,
    seoDescription: body.seoDescription,
    status: body.status,
    visibility: deriveVisibilityFromSettings(body.settings),
  }))

  if (body.status === 'published' && deriveVisibilityFromSettings(body.settings) === 'public') {
    waitUntil(event, (async () => {
      const paths = await indexablePathsForItems(db, siteId, [{
        slug: body.slug,
        locale: body.locale || siteLocale,
        sourceItemId: body.sourceItemId || null,
        typeId: type.id,
      }])
      await submitToIndexNow(db, siteId, paths)
    })().catch(err => console.error('[indexnow] Content create notification failed:', err)))
  }

  queueContentHook(event, siteId, null, { status: body.status, visibility: deriveVisibilityFromSettings(body.settings) }, {
    id, typeId: type.id, title: body.title, slug: body.slug, locale: body.locale || siteLocale, sourceItemId: body.sourceItemId || null,
    publishedAt: body.status === 'published' ? new Date().toISOString() : null,
  })
  queueContentPublishedPush(event, siteId, null, { status: body.status, visibility: deriveVisibilityFromSettings(body.settings) }, {
    title: body.title, slug: body.slug, locale: body.locale || siteLocale, sourceItemId: body.sourceItemId || null,
  })

  return created(event, { id })
})
