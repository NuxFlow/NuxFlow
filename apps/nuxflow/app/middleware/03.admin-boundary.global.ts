// Crossing between /admin and the public site always gets a full page load, never a
// client-side route change. The public site's look is applied by the server while it
// renders the HTML (server/plugins/theme-resolver.ts injects the theme's <style> blocks,
// site-settings-resolver.ts the dark-mode script and font), and both skip /admin pages,
// which have their own colour-mode toggle. So a client-side hop from /admin to / (Sign
// out in the admin sidebar does exactly that) rendered the homepage with no theme CSS and
// in the admin's colour mode — light text on light backgrounds — until a refresh. The
// other direction would carry the public theme's <style> and dark class into the admin.
export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server || useNuxtApp().isHydrating) return
  // The router's initial navigation comes "from" START_LOCATION (path '/', no matches).
  if (!from.matched.length || to.path === from.path) return

  const toAdmin = to.path === '/admin' || to.path.startsWith('/admin/')
  const fromAdmin = from.path === '/admin' || from.path.startsWith('/admin/')
  if (toAdmin !== fromAdmin) return navigateTo(to.fullPath, { external: true })
})
