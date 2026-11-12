import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { getEditorAvailability, publicAvailability } from '../../utils/availability'
import { validationError } from '../../utils/response'

// Holiday-let availability (server/utils/availability.ts). Not under /api: one more typed
// API route address tips `nuxt typecheck` into TS2589, and non-/api routes aren't typed.
//   ?item=<content id>  → the editor's Availability panel (editor+)
//   ?path=<page path>   → the booked nights, for the Availability calendar block
const querySchema = z.object({
  item: z.string().max(40).optional(),
  path: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const q = parseQuery(event, querySchema)

  if (q.item) {
    setHeader(event, 'Cache-Control', 'private, no-store')
    await requireRole(event, 'editor')
    return getEditorAvailability(event, siteId, q.item)
  }

  if (q.path === undefined) throw validationError('Missing page')
  await rateLimit(event, { limit: 120, windowMs: 60_000, keyPrefix: 'availability-read' })
  // Private: the page may be password- or members-only, so no shared copy is kept.
  setHeader(event, 'Cache-Control', 'private, max-age=300')
  return publicAvailability(event, siteId, q.path)
})
