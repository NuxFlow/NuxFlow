import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { loadEditorSiteStyles } from '../../utils/site-styles'

// The site's look — theme CSS, appearance settings, and the stylesheets in its custom
// head HTML — for the Canvas editor's frame, which draws the page being edited the way
// it looks live (theme CSS is never loaded into the admin itself). Anyone who can edit
// content (author+). Not under /api: another typed API route address trips TS2589.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  await requireRole(event, 'author')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return loadEditorSiteStyles(event, siteId)
})
