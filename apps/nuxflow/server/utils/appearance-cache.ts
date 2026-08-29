// Per-isolate cache: stores resolved appearance settings per site so we don't
// hit the DB on every SSR render. Kept in its own plain module (rather than
// inside plugins/site-settings-resolver.ts) so mutation routes can import
// clearAppearanceCache() without pulling in that file's top-level
// defineNitroPlugin() call, which only exists inside the Nitro runtime.
export interface AppearanceCache {
  darkMode: string
  primaryColor: string
  fontSans: string
  customHeadHtml: string
  customBodyHtml: string
  ts: number
}

export const _appearanceCache = new Map<string, AppearanceCache>()
export const APPEARANCE_CACHE_TTL = 60_000

export function clearAppearanceCache(siteId: string): void {
  _appearanceCache.delete(siteId)
}
