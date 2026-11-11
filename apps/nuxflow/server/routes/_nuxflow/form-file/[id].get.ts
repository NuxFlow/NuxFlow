import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { serveFormFile } from '../../../utils/form-files'

const querySchema = z.object({
  field: z.string().min(1).max(200),
  n: z.coerce.number().int().min(0).max(100).default(0),
})

// A file sent with a form submission, for the site's team (Admin → Forms → Submissions).
// Not under /api: it's a link people open, never fetched by the app. Editor+, the same
// people who can read the submissions.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  const { field, n } = parseQuery(event, querySchema)
  return serveFormFile(event, siteId, getRouterParam(event, 'id')!, field, n)
})
