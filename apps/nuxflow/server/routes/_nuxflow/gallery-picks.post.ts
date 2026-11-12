import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { deletePicks, isPickerToken, MAX_PICKS, savePicks } from '../../utils/gallery-picks'
import { forbidden, validationError } from '../../utils/response'
import { writeAuditLog } from '../../utils/audit'

const bodySchema = z.discriminatedUnion('action', [
  // A visitor saves their hearts (every change) or sends them ("Send my picks").
  z.object({
    action: z.literal('save'),
    path: z.string().max(500),
    block: z.string().min(1).max(100),
    token: z.string().max(128),
    name: z.string().trim().min(1, 'Please add your name').max(80),
    photos: z.array(z.string().max(2048)).max(MAX_PICKS),
    note: z.string().max(2000).optional(),
    submit: z.boolean().optional(),
  }),
  // The editor removes one person's picks.
  z.object({ action: z.literal('remove'), item: z.string().max(40), id: z.string().max(40) }),
])

// Client proofing (server/utils/gallery-picks.ts). Not under /api — see gallery-picks.get.ts —
// so the CSRF middleware (which covers /api/**) doesn't see it: requests from another site
// are refused here instead, the way the page-view beacon does.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') throw forbidden('Picks can only be saved from this site')

  const body = await parseBody(event, bodySchema)
  if (body.action === 'remove') {
    const { userId } = await requireRole(event, 'editor')
    await deletePicks(event, siteId, body.item, body.id)
    await writeAuditLog(event, userId, { action: 'delete', resource: 'gallery_picks', resourceId: body.id })
    return { success: true }
  }

  await rateLimit(event, { limit: body.submit ? 10 : 120, windowMs: 60_000, keyPrefix: body.submit ? 'gallery-picks-send' : 'gallery-picks-save' })
  if (!isPickerToken(body.token)) throw validationError('Invalid token')
  return savePicks(event, siteId, body)
})
