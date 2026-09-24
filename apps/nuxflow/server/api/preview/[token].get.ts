import { useDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, gt } from 'drizzle-orm'
import { PREVIEW_COOKIE, PREVIEW_COOKIE_MAX_AGE_SECONDS } from '../../utils/preview'

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

  if (!item) throw notFound('Invalid or expired preview link')

  // Only ever read server-side (findPreviewItem, during the page's own SSR/API fetch), so
  // there's no reason for page script to see it.
  setCookie(event, PREVIEW_COOKIE, token, {
    maxAge: PREVIEW_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestURL(event).protocol === 'https:',
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  return sendRedirect(event, item.slug === 'home' ? '/' : `/${item.slug}`, 302)
})
