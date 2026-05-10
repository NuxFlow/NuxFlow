import { useDb } from '../utils/db'
import { redirects } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) return

  // Only check non-API, non-admin paths
  const path = event.path
  if (path.startsWith('/api') || path.startsWith('/admin') || path.startsWith('/_')) return

  const db = useDb(event)
  const redirect = await db.query.redirects.findFirst({
    where: and(eq(redirects.siteId, siteId), eq(redirects.from, path)),
  })

  if (redirect) {
    return sendRedirect(event, redirect.to, redirect.statusCode)
  }
})
