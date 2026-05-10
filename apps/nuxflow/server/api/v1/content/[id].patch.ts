import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
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
  scheduledAt: z.string().datetime().nullish(),
  settings: z.record(z.unknown()).optional(),
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
      ...body,
      updatedAt: sql`(datetime('now'))`,
      publishedAt: body.status === 'published' && !existing.publishedAt
        ? sql`(datetime('now'))`
        : existing.publishedAt,
    })
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'content_item',
    resourceId: id,
    before: existing,
    after: body,
  })

  return { id }
})
