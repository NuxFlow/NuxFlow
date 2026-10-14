// Click-tracking parameters ad networks, social sites, search engines and email tools
// append to links. Nothing renders differently because of them, so the full-page cache
// ignores them (server/utils/page-cache.ts) and the page payload never records them
// (app/plugins/payload-path.server.ts). Shared by the app and the server, hence `shared/`.
const TRACKING_PARAM_RE = /^(?:utm_\w+|fbclid|gclid|gclsrc|gbraid|wbraid|dclid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|epik|rdt_cid|sc_cid|srsltid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|_gl|ref_src)$/i

export function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_RE.test(key)
}

/**
 * `path` (pathname + query) with every query parameter whose decoded name `drop` accepts
 * removed, or `null` when nothing was removed. The remaining parameters keep their
 * original order and encoding, so the result only differs from the input where something
 * was actually dropped.
 */
export function stripQueryParams(path: string, drop: (key: string) => boolean): string | null {
  const q = path.indexOf('?')
  if (q === -1) return null
  const hash = path.indexOf('#', q)
  const query = path.slice(q + 1, hash === -1 ? undefined : hash)
  const fragment = hash === -1 ? '' : path.slice(hash)
  const pairs = query.split('&')
  const kept = pairs.filter((pair) => {
    if (pair === '') return false
    const rawKey = pair.split('=', 1)[0] ?? ''
    let key = rawKey
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
    } catch {
      // Malformed escape — keep the parameter; it can't be a known name.
    }
    return !drop(key)
  })
  if (kept.length === pairs.length) return null
  return path.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + fragment
}
