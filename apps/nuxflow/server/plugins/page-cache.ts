import { getEdgeCache } from '../utils/edge-cache'
import { isPageCacheEligible, PAGE_BROWSER_CACHE_CONTROL, pageCacheRequest, PAGE_CACHE_TTL_SECONDS } from '../utils/page-cache'
import { getExecutionContext } from '../utils/cf-env'

// Write side of the full-page edge cache — see server/utils/page-cache.ts for the
// eligibility rules (shared with the read side in 07.page-cache.ts) and server/middleware/
// 07.page-cache.ts for why this only ever affects anonymous, default-locale, non-admin/
// API/asset GET requests.
//
// `render:response` is called by Nitro's defineRenderHandler after the page has been
// rendered but before it's sent — the last point where the complete document is available
// in one place. Since Nuxt 4.6 the body arrives as a ReadableStream (Nuxt's renderer
// returns a web Response and its Nitro handler passes `response.body` through) rather than
// a string, and the headers are already set on the event instead of being listed on
// `response.headers`. A string-only check here silently stopped every page from being
// cached after that upgrade, so both shapes are handled: a stream is tee'd, one branch
// going to the visitor and the other into the cache. (Outside a route that opts into
// streaming SSR, which none do, the stream carries an already fully rendered document.)
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (response, { event }) => {
    try {
      if (!isPageCacheEligible(event)) return
      if ((response.statusCode ?? 200) !== 200) return

      const headers = response.headers as Record<string, string | undefined> | undefined
      const contentType = headers?.['content-type'] ?? headers?.['Content-Type'] ?? String(getResponseHeader(event, 'content-type') ?? '')
      if (!contentType.includes('text/html')) return

      const cf = event.context.cloudflare
      if (!cf?.request) return
      // Set by the read side (07.page-cache.ts) before rendering began; see the note there.
      const version = event.context.pageCacheVersion
      if (version === undefined) return

      let cacheBody: string | ReadableStream
      const body: unknown = response.body
      if (typeof body === 'string') {
        if (body.length === 0) return
        cacheBody = body
      } else if (body instanceof ReadableStream) {
        const [toVisitor, toCache] = body.tee()
        response.body = toVisitor
        cacheBody = toCache
      } else {
        return
      }

      // Same browser instruction a later cache hit sends (07.page-cache.ts).
      setResponseHeader(event, 'Cache-Control', PAGE_BROWSER_CACHE_CONTROL)

      const cache = getEdgeCache()
      const cacheResponse = new Response(cacheBody, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': `public, max-age=${PAGE_CACHE_TTL_SECONDS}`,
        },
      })

      const put = cache.put(pageCacheRequest(event, version), cacheResponse).catch((err) => {
        console.error('[page-cache] write failed', err)
      })
      const execCtx = getExecutionContext(event)
      if (execCtx) {
        execCtx.waitUntil(put)
      } else {
        await put
      }
    } catch (err) {
      console.error('[page-cache] write hook failed', err)
    }
  })
})
