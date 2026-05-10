import { useDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')!
  const db = useDb(event)

  // Find item by preview token — tokens stored in settings json
  const item = await db.query.contentItems.findFirst({
    where: eq(contentItems.id, token), // simplified: in prod use a dedicated preview_token column
    columns: { slug: true, siteId: true },
  })

  if (!item) throw createError({ statusCode: 404, message: 'Invalid or expired preview link' })

  // Set preview cookie and redirect
  setCookie(event, '__nuxflow_preview', token, { maxAge: 3600, path: '/', httpOnly: false })
  return sendRedirect(event, `/${item.slug}?preview=1`, 302)
})
