import { createIsolateCache } from './isolate-cache'

export type SetupStatus = {
  hasSite: boolean
  hasAdmin: boolean
  setupCompleted: boolean
  needsSetup: boolean
  site: { name: string; domain: string; locale: string; timezone: string } | null
  /**
   * Whether the MEDIA_BUCKET R2 binding is present — shown in the setup wizard as a plain
   * status line so an operator learns about file storage at install time rather than
   * months later. Deployment-wide (a binding, not a per-site setting); per-site providers
   * configured later in Settings → Media still take effect as normal.
   */
  mediaStorage: 'r2' | 'none'
}

// app/middleware/00.setup-guard.global.ts calls GET /api/v1/setup/status once per SSR render (its own
// useState cache resets every request) — uncached, that's 2 count() scans plus a site
// lookup on every page view of every site, for an answer that almost never changes once
// setup completes. Only the "fully set up" result is cached (a fresh/in-progress install still gets a live check on every
// request, since that flow is low-traffic and needs to react immediately as it
// progresses); api/v1/setup/complete.post.ts clears the entry for its host so the wizard's own
// redirect away from /setup isn't stuck behind the TTL.
const _statusCache = createIsolateCache<SetupStatus>(60_000)

export function getCachedSetupStatus(host: string): SetupStatus | undefined {
  return _statusCache.get(host)
}

export function cacheSetupStatus(host: string, status: SetupStatus): void {
  _statusCache.set(host, status)
}

export function clearSetupStatusCache(host?: string): void {
  if (host) _statusCache.delete(host)
  else _statusCache.clear()
}
