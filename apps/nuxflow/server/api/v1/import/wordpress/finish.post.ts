import { requireRole } from '../../../../utils/permissions'
import { purgeAllPublicPages } from '../../../../utils/edge-cache'
import { requireSiteId } from '../../../../utils/site-context'

// WordPress import, last step: the imported posts belong in the blog index, feeds,
// sitemaps and term archives, so clear the site's cache (a single cache-version bump —
// see server/utils/cache-version.ts).
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  await purgeAllPublicPages(event, requireSiteId(event))
  return { success: true }
})
