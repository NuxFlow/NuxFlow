// Per-isolate cache: which theme is active rarely changes (only on explicit
// activate/reset/customizer-publish calls), but without this every single
// public SSR render hit D1 for it — unlike the appearance-settings cache,
// which already caches for the same reason.
//
// Backed by a shared KV layer (kv-cache.ts) as the second lookup tier, mirroring the
// theme CSS *content* lookup right below in this same concern area (see cf-theme-kv.ts) —
// without it, every new isolate/colo/cold-start paid a full D1 round trip before its own
// 60s isolate cache warmed up.
import type { H3Event } from 'h3'
import { createIsolateCache } from './isolate-cache'
import { kvReadThrough, kvCacheDelete } from './kv-cache'

export type ActiveTheme = { id: string; hasCss: boolean; packageName: string; cssVersion: number } | null

const cache = createIsolateCache<ActiveTheme>(60_000)

const ACTIVE_THEME_KV_TTL_SECONDS = 300

function activeThemeKvKey(siteId: string): string {
  return `theme-active:${siteId}`
}

export function getCachedActiveTheme(siteId: string): ActiveTheme | undefined {
  return cache.get(siteId)
}

export function setCachedActiveTheme(siteId: string, theme: ActiveTheme): void {
  cache.set(siteId, theme)
}

/**
 * isolate cache -> KV -> `load()` (the D1 query for the site's active theme row).
 * Populates both the isolate cache and KV on a miss. `load` is supplied by the caller
 * (theme-resolver.ts) since this module has no request-scoped DB access of its own.
 */
export async function resolveActiveTheme(
  event: H3Event,
  siteId: string,
  load: () => Promise<ActiveTheme>,
): Promise<ActiveTheme> {
  const cached = getCachedActiveTheme(siteId)
  if (cached !== undefined) return cached

  const active = await kvReadThrough<ActiveTheme>(
    event,
    activeThemeKvKey(siteId),
    ACTIVE_THEME_KV_TTL_SECONDS,
    load,
  ) ?? null
  setCachedActiveTheme(siteId, active)
  return active
}

/**
 * Call after any write that changes which theme is active for a site (activate, reset,
 * delete-the-active-theme, customizer publish). Clears both the isolate cache (so this
 * isolate's own next render is immediately correct) and the shared KV entry (so other
 * isolates don't keep serving the old active theme for the rest of
 * ACTIVE_THEME_KV_TTL_SECONDS) — a plain delete-then-repopulate-on-next-read, same
 * reasoning as settings.ts's own invalidation (see kv-cache.ts's kvCacheDelete doc
 * comment): this value is cheap to reconstruct from D1, so there's no equivalent of theme
 * CSS content's versioned-key treatment worth adding here.
 */
export async function clearActiveThemeCache(event: H3Event, siteId: string): Promise<void> {
  cache.delete(siteId)
  await kvCacheDelete(event, activeThemeKvKey(siteId))
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
