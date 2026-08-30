// Per-isolate cache: stores resolved appearance settings per site so we don't
// hit the DB on every SSR render.
import { createIsolateCache } from './isolate-cache'

export interface AppearanceCache {
  darkMode: string
  primaryColor: string
  fontSans: string
  customHeadHtml: string
  customBodyHtml: string
}

const cache = createIsolateCache<AppearanceCache>(60_000)

export function getCachedAppearance(siteId: string): AppearanceCache | undefined {
  return cache.get(siteId)
}

export function setCachedAppearance(siteId: string, entry: AppearanceCache): void {
  cache.set(siteId, entry)
}

export function clearAppearanceCache(siteId: string): void {
  cache.delete(siteId)
}
