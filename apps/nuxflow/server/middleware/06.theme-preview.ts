import type { H3Event } from 'h3'
import { useDb } from '../utils/db'
import { getUserSiteRole, roleAtLeast, type Role } from '../utils/permissions'

// The `?__theme_id=` query param lets an admin preview an inactive theme
// without activating it. Runs after 02.multi-site.ts, so siteId and the
// session cookie are already resolved here. Only an admin (or higher) for
// THIS site may set the preview cookie; otherwise anyone who knew (or guessed)
// a theme's id could preview an unpublished theme. The `/[id]/preview.post.ts` route's "token" was never actually
// checked anywhere, so it wasn't gating anything either — removed rather
// than wired up, since a real admin-role check is strictly stronger and the
// caller is already authenticated when they click "Preview" in the admin UI.
// The cookie is checked the same way: anyone can set a cookie in their own browser, so
// holding one proves nothing. The session lookup only runs when a preview is asked for.
async function canPreviewThemes(event: H3Event): Promise<boolean> {
  const siteId = event.context.siteId
  if (!siteId) return false
  const session = await getAuthSession(event).catch(() => null)
  if (!session) return false
  const roleRow = await getUserSiteRole(useDb(event), session.user.id, siteId)
  return Boolean(roleRow && roleAtLeast(roleRow.role as Role, 'admin'))
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const themeId = query.__theme_id as string | undefined
  const requested = themeId ?? getCookie(event, '__nuxflow_theme_preview')
  if (!requested || !(await canPreviewThemes(event))) return

  if (themeId) {
    setCookie(event, '__nuxflow_theme_preview', themeId, {
      httpOnly: false,
      maxAge: 3600,
      path: '/',
    })
  }
  event.context.themePreviewId = requested
})
