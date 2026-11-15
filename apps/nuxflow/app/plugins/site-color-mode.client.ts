// Keeps the site's forced colour scheme (Settings → Appearance / the Visual Customizer:
// "Always light" / "Always dark") in force while a visitor moves between public pages.
//
// The server marks a forced site with `data-color-mode-forced` on <html>
// (server/plugins/site-settings-resolver.ts), which @nuxtjs/color-mode's inline script
// honours on first paint. But its router hook re-applies the visitor's own preference
// after every navigation unless the route's meta forces a mode. So the mode goes on the
// public route records' meta itself — not in a route middleware, which Vue Router skips
// for a navigation to the page already showing (clicking the logo on the homepage),
// while color-mode's afterEach hook still runs then. Admin routes are left alone: the
// admin has its own toggle.
export default defineNuxtPlugin((nuxtApp) => {
  const forced = document.documentElement.getAttribute('data-color-mode-forced')
  if (forced !== 'light' && forced !== 'dark') return

  for (const record of nuxtApp.$router.getRoutes()) {
    if (record.path === '/admin' || record.path.startsWith('/admin/')) continue
    record.meta.colorMode = forced
  }
})
