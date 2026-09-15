// Serves the Vue runtime build bundled into the Worker via nitro.serverAssets (see
// nuxt.config.ts) — used only inside the sandboxed plugin iframe
// (_nuxflow/plugin-frame/[pluginId]/[blockType].get.ts imports this by URL). Not
// readable from node_modules at request time since Cloudflare Workers has no
// filesystem access, hence the build-time asset bundling.
export default defineEventHandler(async (event) => {
  const code = await useStorage('assets/vendor').getItem<string>('vue-runtime.js')
  if (!code) throw notFound('Vue runtime asset not found')

  setHeader(event, 'content-type', 'application/javascript; charset=utf-8')
  // Long-lived and safe to cache aggressively — this file only changes when the
  // `vue` dependency is bumped and the checked-in copy is regenerated, which is a
  // full redeploy either way (new Worker version, new cache key implicitly via URL
  // versioning if ever needed — not versioned today since it's not yet a proven pain point).
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'cache-control', 'public, max-age=86400')
  return code
})
