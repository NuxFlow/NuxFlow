import { isTrackingParam, stripQueryParams } from '../../shared/lib/tracking-params'

// Nuxt records the URL a page was rendered at in its payload (`payload.path`). The full-page
// cache (server/utils/page-cache.ts) ignores click-tracking parameters, so a page rendered
// for `/about?fbclid=…` is served to every later visitor of `/about` — without this, that
// first visitor's click id would be recorded in HTML everyone else gets.
//
// When the URL had tracking parameters, only the pathname is recorded, not the remaining
// query. On hydration Nuxt compares `payload.path` with the address bar's pathname: when
// they match it takes the query string from the address bar, so each visitor keeps their
// own (`?page=2&gclid=…` included). A recorded query would make them differ, and Nuxt would
// then navigate to the recorded URL instead — dropping the visitor's own parameters.
export default defineNuxtPlugin({
  name: 'nuxflow:payload-path',
  setup(nuxtApp) {
    const path = nuxtApp.payload.path
    if (!path || stripQueryParams(path, isTrackingParam) === null) return
    nuxtApp.payload.path = path.slice(0, path.indexOf('?'))
  },
})
