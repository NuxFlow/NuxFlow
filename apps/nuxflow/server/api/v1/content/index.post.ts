import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole, roleAtLeast } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getContentTypeBySlugOrThrow, deriveVisibilityFromSettings } from '../../../utils/content-queries'
import { created } from '../../../utils/response'
import { purgeContentCache } from '../../../utils/edge-cache'
import { contentItems, sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

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
})

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  // Only editor+ may publish/schedule directly — mirrors the identical check already
  // enforced for the MCP `update_content` tool. An `author` (the floor for content-write
  // access) is limited to draft/review, matching the review workflow those statuses exist for.
  if ((body.status === 'published' || body.status === 'scheduled') && !roleAtLeast(role, 'editor')) {
    forbidden('Only an editor or higher can publish or schedule content')
  }

  const type = await getContentTypeBySlugOrThrow(db, siteId, body.typeSlug, 'Content type not found')

  // Resolve default site locale
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { locale: true },
  })
  const siteLocale = site?.locale || 'en'

  const id = ulid()
  const itemInsert = db.insert(contentItems).values({
    id,
    siteId,
    typeId: type.id,
    authorId: userId,
    title: body.title,
    slug: body.slug,
    status: body.status,
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

  await batchWithAudit(db, [itemInsert], auditInsert)

  // A brand-new slug can't already be cached, but the site-wide views (blog index,
  // sitemaps, feeds) that could now list it might be — purge those.
  await purgeContentCache(event, { slugs: [body.slug] })

  return created(event, { id })
})
