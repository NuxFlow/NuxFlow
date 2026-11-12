import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { addFeed, addOwnBlock, removeFeed, removeOwnBlock, syncItemFeeds } from '../../utils/availability'
import { isDemoMode } from '../../utils/demo-mode'
import { forbidden } from '../../utils/response'
import { writeAuditLog } from '../../utils/audit'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const item = z.string().min(1).max(40)
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add-feed'), item, url: z.string().min(1).max(2000), label: z.string().max(60).default('') }),
  z.object({ action: z.literal('remove-feed'), item, id: z.string().max(40) }),
  z.object({ action: z.literal('add-block'), item, start: date, end: date, note: z.string().max(200).optional() }),
  z.object({ action: z.literal('remove-block'), item, id: z.string().max(40) }),
  z.object({ action: z.literal('sync'), item }),
])

// The editor's Availability panel (server/utils/availability.ts). Not under /api — see
// availability.get.ts — so the CSRF middleware (which covers /api/**) doesn't see it:
// requests from another site are refused here instead.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') throw forbidden('Availability can only be changed from this site')

  const { userId } = await requireRole(event, 'editor')
  const body = await parseBody(event, bodySchema)

  // Following a calendar makes the Worker fetch an address someone typed in.
  const fetches = body.action === 'add-feed' || body.action === 'sync'
  if (fetches && isDemoMode(event)) throw forbidden('Following calendars is switched off in the demo.')
  if (fetches) await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'availability-sync' })

  switch (body.action) {
    case 'add-feed': {
      const feed = await addFeed(event, siteId, body.item, body.url, body.label)
      await writeAuditLog(event, userId, { action: 'create', resource: 'availability_feeds', resourceId: feed.id })
      return { feed }
    }
    case 'remove-feed':
      await removeFeed(event, siteId, body.item, body.id)
      await writeAuditLog(event, userId, { action: 'delete', resource: 'availability_feeds', resourceId: body.id })
      return { success: true }
    case 'add-block': {
      const result = await addOwnBlock(event, siteId, body.item, body)
      await writeAuditLog(event, userId, { action: 'create', resource: 'availability_blocks', resourceId: result.id })
      return result
    }
    case 'remove-block':
      await removeOwnBlock(event, siteId, body.item, body.id)
      await writeAuditLog(event, userId, { action: 'delete', resource: 'availability_blocks', resourceId: body.id })
      return { success: true }
    case 'sync':
      return { feeds: await syncItemFeeds(event, siteId, body.item) }
  }
})
