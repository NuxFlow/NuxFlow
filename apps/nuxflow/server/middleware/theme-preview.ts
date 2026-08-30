import { useDb } from '../utils/db'
import { getUserSiteRole, roleAtLeast, type Role } from '../utils/permissions'

// The `?__theme_id=` query param lets an admin preview an inactive theme
// without activating it. Runs after 02.multi-site.ts, so siteId and the
// session cookie are already resolved here. Only an admin (or higher) for
// THIS site may set the preview cookie — this used to accept any visitor's
// `__theme_id` unconditionally, which meant anyone who knew (or guessed) a
// theme's id could force a 1-hour preview of it on themselves with no auth
// at all. The `/[id]/preview.post.ts` route's "token" was never actually
// checked anywhere, so it wasn't gating anything either — removed rather
// than wired up, since a real admin-role check is strictly stronger and the
// caller is already authenticated when they click "Preview" in the admin UI.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const themeId = query.__theme_id as string | undefined

  if (themeId) {
    const siteId = event.context.siteId as string | null
    if (siteId) {
      const session = await getAuthSession(event)
      if (session) {
        const db = useDb(event)
        const roleRow = await getUserSiteRole(db, session.user.id, siteId)
        if (roleRow && roleAtLeast(roleRow.role as Role, 'admin')) {
          setCookie(event, '__nuxflow_theme_preview', themeId, {
            httpOnly: false,
            maxAge: 3600,
            path: '/',
          })
          event.context.themePreviewId = themeId
        }
      }
    }
  } else {
    const preview = getCookie(event, '__nuxflow_theme_preview')
    if (preview) event.context.themePreviewId = preview
  }
})
