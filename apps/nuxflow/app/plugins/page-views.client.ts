// Visitor analytics (Admin → Analytics): one beacon per public page view, to
// POST /_nuxflow/view — see server/utils/analytics.ts for why views are counted from
// the browser. No cookie, no storage, no identifier: the beacon carries the page path
// and, for the first page of a visit only, document.referrer (the server keeps just its
// host). Only sent when the site is recording (`pageViews` on GET /api/public/site).

// Never counted: the admin, sign-in and account pages. The server applies the full rule
// (normalizeViewPath); this just saves the request.
const SKIP = /^\/(?:admin|account|login|register|forgot-password|reset-password|setup|authorize|_)(?:\/|$)/

export default defineNuxtPlugin((nuxtApp) => {
  // Same payload entry app.vue fetches (key 'nuxflow-public-site') — see
  // dynamic-plugins.client.ts for why this read needs no extra request.
  const site = useNuxtData<{ pageViews?: boolean }>('nuxflow-public-site')
  const error = useError()
  // Set by PublicContentPage for a path it's showing "Page not found" (or another error) on.
  const uncountedPath = useState<string | null>('nuxflow:uncounted-view-path', () => null)
  const router = useRouter()
  let lastPath: string | null = null
  let firstView = true

  function send(path: string) {
    const body = JSON.stringify({ path, referrer: firstView ? document.referrer : '' })
    firstView = false
    try {
      if (navigator.sendBeacon?.('/_nuxflow/view', body)) return
    } catch { /* fall through to fetch */ }
    fetch('/_nuxflow/view', { method: 'POST', body, keepalive: true }).catch(() => { /* best-effort */ })
  }

  // page:finish fires once the page has rendered, on the first load and after every
  // navigation — so a view is only counted for a page that actually showed.
  nuxtApp.hook('page:finish', () => {
    if (!site.data.value?.pageViews || error.value) return
    const path = router.currentRoute.value.path
    if (path === lastPath || path === uncountedPath.value || SKIP.test(path)) return
    lastPath = path
    send(path)
  })
})
