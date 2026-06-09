import { useDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, gt } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')!
  const siteId = event.context.siteId!
  const db = useDb(event)

  const item = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.previewToken, token),
      eq(contentItems.siteId, siteId),
      gt(contentItems.previewTokenExpiresAt, new Date().toISOString()),
    ),
    columns: { slug: true },
  })

  if (!item) throw createError({ statusCode: 404, message: 'Invalid or expired preview link' })

  setCookie(event, '__nuxflow_preview', token, { maxAge: 3600, path: '/', httpOnly: false })
  return sendRedirect(event, `/${item.slug}?preview=1`, 302)
})
