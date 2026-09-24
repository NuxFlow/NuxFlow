// Fetched from inside the sandboxed plugin iframe (see
// _nuxflow/plugin-frame/[pluginId]/[...blockName].get.ts), whose sandbox="allow-scripts"
// (no allow-same-origin) gives it an opaque origin — the browser treats any call to
// /_nuxflow/ext/** as cross-origin regardless of it being "our own" domain, and a JSON POST
// body (Content-Type: application/json is not a CORS-"simple" content type) triggers a
// preflight OPTIONS request first. Safe to wildcard: that route never forwards
// Cookie/Authorization to the plugin (see FORWARDABLE_HEADERS there), so it was already safe
// to call without a session regardless of origin.
export const PLUGIN_EXT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const

// Headers a plugin could use to act on the site's own origin rather than just its own
// response body.
const STRIPPED_PLUGIN_RESPONSE_HEADERS = ['set-cookie', 'set-cookie2', 'clear-site-data']

/**
 * A plugin server's response is served from the site's own origin, so its headers can't be
 * passed through verbatim: a plugin returning `Content-Type: text/html` would get a
 * same-origin page (full access to the visitor's session if someone is lured into opening
 * the URL directly), and `Set-Cookie` would let it plant cookies on the site's domain.
 * Cookie-related headers are dropped, and every response is forced into an opaque-origin
 * CSP sandbox with no MIME sniffing — JSON/text APIs consumed via fetch() are unaffected
 * (CSP only governs documents), but nothing a plugin returns can execute as the site.
 */
export function confinePluginResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream)
  for (const name of STRIPPED_PLUGIN_RESPONSE_HEADERS) headers.delete(name)
  headers.set('Content-Security-Policy', 'sandbox; default-src \'none\'')
  headers.set('X-Content-Type-Options', 'nosniff')
  for (const [key, value] of Object.entries(PLUGIN_EXT_CORS_HEADERS)) headers.set(key, value)
  return headers
}
