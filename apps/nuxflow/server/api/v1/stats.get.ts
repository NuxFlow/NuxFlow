import { useDb } from '../../utils/db'
import { requireAuth } from '../../utils/permissions'
import { contentItems, media, formSubmissions, userSiteRoles } from '@nuxflow/db/schema'
import { and, eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [[pages], [mediaFiles], [submissions], [users]] = await Promise.all([
    db.select({ value: count() }).from(contentItems)
      .where(and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'))),
    db.select({ value: count() }).from(media)
      .where(eq(media.siteId, siteId)),
    db.select({ value: count() }).from(formSubmissions)
      .where(and(eq(formSubmissions.siteId, siteId), eq(formSubmissions.status, 'new'))),
    db.select({ value: count() }).from(userSiteRoles)
      .where(eq(userSiteRoles.siteId, siteId)),
  ])

  return {
    publishedPages: pages?.value ?? 0,
    mediaFiles: mediaFiles?.value ?? 0,
    newSubmissions: submissions?.value ?? 0,
    users: users?.value ?? 0,
  }
})
