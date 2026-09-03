// Per-isolate cache: which theme is active rarely changes (only on explicit
// activate/reset/customizer-publish calls), but without this every single
// public SSR render hit D1 for it — unlike the appearance-settings cache,
// which already caches for the same reason.
import { createIsolateCache } from './isolate-cache'

export type ActiveTheme = { id: string; hasCss: boolean; packageName: string; cssVersion: number } | null

const cache = createIsolateCache<ActiveTheme>(60_000)

export function getCachedActiveTheme(siteId: string): ActiveTheme | undefined {
  return cache.get(siteId)
}

export function setCachedActiveTheme(siteId: string, theme: ActiveTheme): void {
  cache.set(siteId, theme)
}

export function clearActiveThemeCache(siteId: string): void {
  cache.delete(siteId)
}

// Caches the already-sanitized CSS *content* for a theme, not just which theme is
// active — without this, every public SSR render re-fetched the CSS from KV (and
// re-ran the sanitizer regexes over it) on every single request. `undefined` = not
// yet cached; `null` = cached "this theme has no CSS in KV".
const cssCache = createIsolateCache<string | null>(60_000)

function cssCacheKey(siteId: string, themeId: string): string {
  return `${siteId}:${themeId}`
}

export function getCachedThemeCss(siteId: string, themeId: string): string | null | undefined {
  return cssCache.get(cssCacheKey(siteId, themeId))
}

export function setCachedThemeCss(siteId: string, themeId: string, css: string | null): void {
  cssCache.set(cssCacheKey(siteId, themeId), css)
}

export function clearCachedThemeCss(siteId: string, themeId: string): void {
  cssCache.delete(cssCacheKey(siteId, themeId))
}
