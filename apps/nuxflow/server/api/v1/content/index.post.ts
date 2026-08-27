import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { getContentTypeBySlugOrThrow } from '../../../utils/content-queries'
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
  locale: z.string().max(10).optional(),
  sourceItemId: z.string().optional(),
  eventStartAt: z.string().nullish(),
  eventEndAt: z.string().nullish(),
  eventLocation: z.string().max(500).nullish(),
  eventUrl: z.string().max(2048).nullish(),
  eventAllDay: z.boolean().nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const type = await getContentTypeBySlugOrThrow(db, siteId, body.typeSlug, 'Content type not found')

  // Resolve default site locale
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { locale: true },
  })
  const siteLocale = site?.locale || 'en'

  const id = ulid()
  await db.insert(contentItems).values({
    id,
    siteId,
    typeId: type.id,
    authorId: userId,
    title: body.title,
    slug: body.slug,
    status: body.status,
    content: body.content,
    seoTitle: body.seoTitle,
    seoDescription: body.seoDescription,
    locale: body.locale || siteLocale,
    sourceItemId: body.sourceItemId || null,
    eventStartAt: body.eventStartAt || null,
    eventEndAt: body.eventEndAt || null,
    eventLocation: body.eventLocation || null,
    eventUrl: body.eventUrl || null,
    eventAllDay: body.eventAllDay || null,
  })

  await writeAuditLog(event, userId, { action: 'create', resource: 'content_item', resourceId: id })

  setResponseStatus(event, 201)
  return { id }
})
