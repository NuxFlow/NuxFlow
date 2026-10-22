import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { isMemberPool } from '../utils/control-plane'
import { isHostingPlatform } from '../utils/hosting-platform'
import { poolBindings } from '../utils/pools'
import { syncSiteDirectory } from '../utils/site-directory'

/**
 * Hourly: rebuilds the site directory the front-door router reads (site-directory.ts)
 * from what the member pools report — a backstop for anything Super Admin → Pools didn't
 * sync. Does nothing on an install without pool bindings, with hosting off, or on a pool.
 */
export const syncPoolDirectory = async () => {
  if (isMemberPool()) return { skipped: 'member pool' }
  const event = createSystemEvent({ env: globalThis.__env__ })
  if (!poolBindings(event).length) return { skipped: 'no pools' }
  if (!(await isHostingPlatform(useDb(event)))) return { skipped: 'hosting off' }
  const result = await syncSiteDirectory(event)
  if (result.conflicts.length || result.unreachable.length) {
    console.warn('[pool-directory-sync]', JSON.stringify({ conflicts: result.conflicts, unreachable: result.unreachable }))
  }
  return { routed: result.routed, added: result.added.length, removed: result.removed.length }
}
