import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { resolveSetting } from '../../../utils/settings'
import { broadcastPushToSite } from '../../../utils/webpush'
import { contentItems, contentRevisions } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(500).optional(),
  status: z.enum(['draft', 'review', 'published', 'scheduled', 'archived']).optional(),
  content: z.unknown().optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  canonicalUrl: z.string().max(2048).nullish(),
  focusKeyword: z.string().max(200).nullish(),
  metaRobots: z.enum(['index,follow', 'noindex,follow', 'noindex,nofollow', 'index,nofollow']).nullish(),
  scheduledAt: z.string().datetime().nullish(),
  settings: z.record(z.string(), z.unknown()).optional(),
  excerpt: z.string().max(2000).nullish(),
  ogImage: z.string().max(2048).nullish(),
  allowComments: z.boolean().nullable().optional(),
  // Optional optimistic lock: client sends the version it last saw.
  // Server returns 409 if the item has since been updated by someone else.
  expectedVersion: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
  })
  if (!existing) throw createError({ statusCode: 404, message: 'Not found' })

  const { expectedVersion, ...updateFields } = body
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw createError({
      statusCode: 409,
      message: 'Content has been modified since you last loaded it',
      data: { currentVersion: existing.version },
    })
  }

  const nextVersion = existing.version + 1

  // Snapshot revision before update
  await db.insert(contentRevisions).values({
    id: ulid(),
    itemId: id,
    authorId: userId,
    title: existing.title,
    content: existing.content,
  })

  await db.update(contentItems)
    .set({
      ...updateFields,
      version: nextVersion,
      updatedAt: sql`(datetime('now'))`,
      publishedAt: updateFields.status === 'published' && !existing.publishedAt
        ? sql`(datetime('now'))`
        : existing.publishedAt,
    })
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'content_item',
    resourceId: id,
    before: existing,
    after: updateFields,
  })

  // Push broadcast when content is first published
  const isFirstPublish = updateFields.status === 'published' && existing.status !== 'published'
  if (isFirstPublish) {
    const enabled = await resolveSetting(event, 'push.events.content_published')
    if (enabled === 'true') {
      broadcastPushToSite(event, {
        title: body.title ?? existing.title,
        body: 'New content has been published.',
        url: `/${updateFields.slug ?? existing.slug}`,
      }).catch(err => console.error('[push] Content publish broadcast failed:', err))
    }
  }

  return { id, version: nextVersion }
})
