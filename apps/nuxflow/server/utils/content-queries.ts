import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Db } from './db'

export async function getContentItemOrThrow(db: Db, siteId: string, id: string, message = 'Content item not found') {
  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getContentTypeBySlugOrThrow(db: Db, siteId: string, slug: string, message = 'Content type not found') {
  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, slug)),
  })
  if (!type) notFound(message)
  return type
}
