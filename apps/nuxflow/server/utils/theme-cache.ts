// Per-isolate cache: which theme is active rarely changes (only on explicit
// activate/reset/customizer-publish calls), but without this every single
// public SSR render hit D1 for it — unlike the appearance-settings cache,
// which already caches for the same reason.
import { createIsolateCache } from './isolate-cache'

export type ActiveTheme = { id: string; hasCss: boolean; packageName: string } | null

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
