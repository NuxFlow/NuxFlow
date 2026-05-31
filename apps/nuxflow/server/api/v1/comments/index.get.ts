import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { comments, contentItems, users } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const status = (query.status as string) || 'pending'

  const conditions = [eq(comments.siteId, siteId)]
  if (status !== 'all') {
    conditions.push(eq(comments.status, status as 'pending' | 'approved' | 'spam' | 'trash'))
  }

  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      status: comments.status,
      createdAt: comments.createdAt,
      parentId: comments.parentId,
      guestName: comments.guestName,
      guestEmail: comments.guestEmail,
      authorId: comments.authorId,
      authorName: users.name,
      authorEmail: users.email,
      itemId: comments.itemId,
      itemTitle: contentItems.title,
      itemSlug: contentItems.slug,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .leftJoin(contentItems, eq(comments.itemId, contentItems.id))
    .where(and(...conditions))
    .orderBy(desc(comments.createdAt))
    .limit(100)

  return { comments: rows }
})
