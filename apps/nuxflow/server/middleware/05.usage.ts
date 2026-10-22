import { isPageCachePath } from '../utils/page-cache'
import { countUsage } from '../utils/usage'

// A path ending in a file extension is a missing asset or a feed, not a page view.
const FILE_PATH = /\.[a-z0-9]{1,8}$/i

// Counts page views and API requests per site (server/utils/usage.ts). Runs before
// 07.page-cache.ts on purpose: a page served from the edge cache never reaches anything
// later, and a cached view is still a view. Requests with no site (the accounts origin,
// /api/auth, setup) aren't counted — 02.multi-site.ts leaves siteId unset for them.
export default defineEventHandler((event) => {
  const siteId = event.context.siteId
  if (!siteId || event.context.isAccountsHost) return

  const path = getRequestURL(event).pathname
  if (path.startsWith('/api/')) {
    countUsage(event, 'api', 1, siteId)
    return
  }
  if (event.method === 'GET' && isPageCachePath(path) && !FILE_PATH.test(path)) {
    countUsage(event, 'views', 1, siteId)
  }
})
