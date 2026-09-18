import { contentItems, contentRevisions } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getContentTypeBySlugOrThrow } from '../../../utils/content-queries'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { purgeContentCache } from '../../../utils/edge-cache'
import { scopedById } from '../../../utils/db-helpers'
import type { BatchItem } from 'drizzle-orm/batch'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const type = await getContentTypeBySlugOrThrow(db, siteId, 'page', 'Page content type not found', { id: true })

  const page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.slug, 'home'),
    ),
    columns: { id: true, version: true, title: true, content: true, slug: true },
  })
  if (!page) throw notFound('Homepage not found')

  const nextVersion = page.version + 1

  // Wiping the homepage's content is destructive and irreversible without this — route it
  // through the same revision-snapshot + audit-log + version-bump pipeline every other
  // content mutation uses (see content/[id].patch.ts), rather than a raw update with no trace.
  const itemUpdate = db.update(contentItems)
    .set({ content: null, version: nextVersion, updatedAt: sql`(datetime('now'))` })
    .where(scopedById(contentItems.id, page.id, contentItems.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'content_item',
    resourceId: page.id,
    before: { title: page.title, content: page.content },
    after: { content: null, reset: true },
  })

  const writes: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    db.insert(contentRevisions).values({
      id: ulid(),
      itemId: page.id,
      authorId: userId,
      title: page.title,
      content: page.content,
    }),
    itemUpdate,
  ]
  await batchWithAudit(db, writes, auditInsert)

  await purgeContentCache(event, { slugs: [page.slug] })

  return { success: true, version: nextVersion }
})
