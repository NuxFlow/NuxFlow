import { useDb } from '../../../utils/db'
import { contentItems, contentTypes, redirects } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const slug = getRouterParam(event, 'slug')!

  // Check redirects first
  const redirect = await db.query.redirects.findFirst({
    where: and(eq(redirects.siteId, siteId), eq(redirects.from, `/${slug}`)),
  })
  if (redirect) {
    return sendRedirect(event, redirect.to, redirect.statusCode)
  }

  const page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.slug, slug),
      eq(contentItems.status, 'published'),
    ),
  })

  if (!page) throw createError({ statusCode: 404, message: 'Not found' })

  const type = page.typeId
    ? await db.query.contentTypes.findFirst({
        where: eq(contentTypes.id, page.typeId),
        columns: { hasComments: true },
      })
    : null

  // Per-item override takes precedence; null means "inherit from content type"
  const hasComments = page.allowComments !== null && page.allowComments !== undefined
    ? page.allowComments
    : (type?.hasComments ?? false)

  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    content: page.content,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImage: page.ogImage,
    publishedAt: page.publishedAt,
    hasComments,
  }
})
