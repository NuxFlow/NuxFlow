import { useDb } from '../utils/db'
import { findRedirect } from '../utils/redirect-cache'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) return

  // Only check non-API, non-admin paths
  const path = event.path
  if (path.startsWith('/api') || path.startsWith('/admin') || path.startsWith('/_')) return

  const db = useDb(event)
  const redirect = await findRedirect(db, siteId, path)

  if (redirect) {
    return sendRedirect(event, redirect.to, redirect.statusCode)
  }
})
