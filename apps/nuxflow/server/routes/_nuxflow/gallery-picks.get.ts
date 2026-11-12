import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { getOwnPicks, isPickerToken, listPicksForItem } from '../../utils/gallery-picks'
import { validationError } from '../../utils/response'

// Client proofing (server/utils/gallery-picks.ts). Not under /api: one more typed API route
// address tips `nuxt typecheck` into TS2589, and non-/api routes aren't typed.
//   ?item=<content id>                → everyone's picks on that page, for its editor (editor+)
//   ?path=&block=&token=              → a visitor's own picks, to restore their hearts
const querySchema = z.object({
  item: z.string().max(40).optional(),
  path: z.string().max(500).optional(),
  block: z.string().max(100).optional(),
  token: z.string().max(128).optional(),
})

export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const q = parseQuery(event, querySchema)
  setHeader(event, 'Cache-Control', 'private, no-store')

  if (q.item) {
    await requireRole(event, 'editor')
    return { pickers: await listPicksForItem(event, siteId, q.item) }
  }

  await rateLimit(event, { limit: 120, windowMs: 60_000, keyPrefix: 'gallery-picks-read' })
  if (!q.block || !q.token || !isPickerToken(q.token)) throw validationError('Missing gallery or token')
  return { picks: await getOwnPicks(event, siteId, q.path ?? '', q.block, q.token) }
})
