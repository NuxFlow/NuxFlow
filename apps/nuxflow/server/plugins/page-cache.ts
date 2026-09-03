import type { EdgeCacheStorage } from '../utils/edge-cache'
import { isPageCacheEligible, pageCacheRequest, PAGE_CACHE_TTL_SECONDS } from '../utils/page-cache'

// Write side of the full-page edge cache — see server/utils/page-cache.ts for the
// eligibility rules (shared with the read side in 07.page-cache.ts) and server/middleware/
// 07.page-cache.ts for why this only ever affects anonymous, default-locale, non-admin/
// API/asset GET requests.
//
// `render:response` fires after Nitro/Nuxt has fully assembled the response but before it
// reaches the client — the last point where the complete HTML document (as a plain string;
// this app doesn't use streaming SSR) is available in one place, alongside the headers
// that are actually about to be sent.
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (response, { event }) => {
    try {
      if (!isPageCacheEligible(event)) return
      if ((response.statusCode ?? 200) !== 200) return
      if (typeof response.body !== 'string' || response.body.length === 0) return

      const contentType = response.headers?.['content-type'] ?? response.headers?.['Content-Type'] ?? ''
      if (!contentType.includes('text/html')) return

      const cf = event.context.cloudflare
      if (!cf?.request) return

      const cache = (caches as unknown as EdgeCacheStorage).default
      const cacheResponse = new Response(response.body, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': `public, max-age=${PAGE_CACHE_TTL_SECONDS}`,
        },
      })

      const put = cache.put(pageCacheRequest(event), cacheResponse).catch((err) => {
        console.error('[page-cache] write failed', err)
      })
      if (cf.ctx?.waitUntil) {
        cf.ctx.waitUntil(put)
      } else {
        await put
      }
    } catch (err) {
      console.error('[page-cache] write hook failed', err)
    }
  })
})
