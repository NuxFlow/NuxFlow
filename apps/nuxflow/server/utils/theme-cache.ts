// Per-isolate cache: which theme is active rarely changes (only on explicit
// activate/reset/customizer-publish calls), but without this every single
// public SSR render hit D1 for it — unlike the appearance-settings cache,
// which already caches for the same reason. Kept in its own plain module
// (rather than inside plugins/theme-resolver.ts) so mutation routes can
// import clearActiveThemeCache() without pulling in that file's top-level
// defineNitroPlugin() call, which only exists inside the Nitro runtime.
export type ActiveTheme = { id: string; hasCss: boolean } | null

const _activeThemeCache = new Map<string, { theme: ActiveTheme; expires: number }>()
const ACTIVE_THEME_CACHE_TTL = 60_000

export function getCachedActiveTheme(siteId: string): ActiveTheme | undefined {
  const cached = _activeThemeCache.get(siteId)
  if (cached && cached.expires > Date.now()) return cached.theme
  return undefined
}

export function setCachedActiveTheme(siteId: string, theme: ActiveTheme): void {
  _activeThemeCache.set(siteId, { theme, expires: Date.now() + ACTIVE_THEME_CACHE_TTL })
}

export function clearActiveThemeCache(siteId: string): void {
  _activeThemeCache.delete(siteId)
}
