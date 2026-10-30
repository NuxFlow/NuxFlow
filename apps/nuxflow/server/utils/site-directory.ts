import type { H3Event } from 'h3'
import { eq, inArray, sql } from 'drizzle-orm'
import { siteDirectory, siteDomains, sites } from '@nuxflow/db/schema'
import { useDb } from './db'
import { getCfBindings } from './cf-env'
import { describePools } from './pools'
import { isServedCopy } from './move-state'
import { directoryKey, normalizeHostname, poolBindingName } from '../../shared/lib/pool-id'
import { httpError } from './response'

/**
 * The site directory: which member pool serves each address, for the front-door router
 * (packages/router), which sends every request for a customer address to the right
 * Worker. Only pool addresses are listed — anything else goes to the control plane, so
 * its own sites need no entries and a missing entry fails safe (the control plane answers,
 * as it does without pools).
 *
 * `site_directory` here is the record; the router reads a KV copy (`pool-route:<host>` →
 * pool id, in this Worker's PLUGIN_KV namespace). syncSiteDirectory() rebuilds both from
 * what the pools report — from Super Admin → Pools and hourly (`pool-directory-sync`).
 */

export interface DirectoryConflict {
  hostname: string
  reason: string
}

export interface DirectorySyncResult {
  /** Addresses now routed to a pool. */
  routed: number
  added: string[]
  removed: string[]
  /** Addresses left out: they'd send a site's visitors to the wrong place. */
  conflicts: DirectoryConflict[]
  /** Pools that didn't answer — their existing entries were kept. */
  unreachable: string[]
}

interface Entry { hostname: string; poolId: string; poolSiteId: string }

export async function syncSiteDirectory(event: H3Event): Promise<DirectorySyncResult> {
  const kv = getCfBindings(event).kv
  if (!kv) throw httpError({ status: 503, message: 'The PLUGIN_KV binding is missing, so the router\'s copy of the directory can\'t be written.' })
  const db = useDb(event)
  const [pools, existing] = await Promise.all([describePools(event), db.select().from(siteDirectory)])

  // What each reachable pool serves now.
  const claims = new Map<string, Entry[]>()
  const reached = new Set<string>()
  for (const pool of pools) {
    const poolId = pool.status?.poolId
    if (pool.error || !poolId) continue
    reached.add(poolId)
    for (const site of pool.sites) {
      for (const host of [site.domain, ...(site.aliases ?? [])]) {
        const hostname = normalizeHostname(host)
        if (!hostname) continue
        const list = claims.get(hostname) ?? []
        if (!list.some(e => e.poolId === poolId)) list.push({ hostname, poolId, poolSiteId: site.id })
        claims.set(hostname, list)
      }
    }
  }

  const conflicts: DirectoryConflict[] = []
  const candidates: Entry[] = []
  for (const [hostname, list] of claims) {
    if (list.length > 1) conflicts.push({ hostname, reason: `claimed by several pools (${list.map(e => e.poolId).join(', ')})` })
    else candidates.push(list[0]!)
  }

  // An address one of the control plane's own sites uses stays with it.
  const hostnames = candidates.map(e => e.hostname)
  const [ownDomains, ownAliases] = hostnames.length
    ? await Promise.all([
        db.select({ hostname: sites.domain, moveState: sites.moveState }).from(sites).where(inArray(sites.domain, hostnames)),
        db.select({ hostname: siteDomains.hostname, moveState: sites.moveState }).from(siteDomains)
          .innerJoin(sites, eq(sites.id, siteDomains.siteId)).where(inArray(siteDomains.hostname, hostnames)),
      ])
    : [[], []]
  // A copy here that is mid-move or left behind by one (site-move.ts) doesn't hold its addresses.
  const ownHosts = new Set([...ownDomains, ...ownAliases].filter(r => isServedCopy(r.moveState)).map(r => r.hostname))
  const entries = candidates.filter((e) => {
    if (!ownHosts.has(e.hostname)) return true
    conflicts.push({ hostname: e.hostname, reason: `pool ${e.poolId} has it, but a site on this control panel uses it too` })
    return false
  })

  // A pool that didn't answer keeps what it had, so a blip never takes its sites offline;
  // a pool whose binding was removed loses its entries.
  const unreachable = pools.filter(p => p.error).map(p => p.binding)
  const kept = existing.filter(row => !reached.has(row.poolId)
    && unreachable.includes(poolBindingName(row.poolId))
    && !entries.some(e => e.hostname === row.hostname))
  const target = new Map<string, Entry>([...kept, ...entries].map(e => [e.hostname, { hostname: e.hostname, poolId: e.poolId, poolSiteId: e.poolSiteId }]))

  const current = new Map(existing.map(row => [row.hostname, row]))
  const added: string[] = []
  const removed: string[] = []
  // KV is what the router actually reads, so every sync checks it too (a KV read is far
  // cheaper than a write) — a key lost or never written is put back, not just a row change.
  for (const entry of target.values()) {
    const row = current.get(entry.hostname)
    const rowCurrent = !!row && row.poolId === entry.poolId && row.poolSiteId === entry.poolSiteId
    if (await kv.get(directoryKey(entry.hostname)) !== entry.poolId) await kv.put(directoryKey(entry.hostname), entry.poolId)
    if (rowCurrent) continue
    await db.insert(siteDirectory).values(entry)
      .onConflictDoUpdate({ target: siteDirectory.hostname, set: { poolId: entry.poolId, poolSiteId: entry.poolSiteId, updatedAt: sql`(datetime('now'))` } })
    added.push(entry.hostname)
  }
  for (const row of existing) {
    if (target.has(row.hostname)) continue
    await kv.delete(directoryKey(row.hostname))
    await db.delete(siteDirectory).where(eq(siteDirectory.hostname, row.hostname))
    removed.push(row.hostname)
  }

  return { routed: target.size, added, removed, conflicts, unreachable }
}

/** How many addresses the router sends to each pool, for the Pools page. */
export async function directoryCounts(event: H3Event): Promise<Record<string, number>> {
  const rows = await useDb(event).select({ poolId: siteDirectory.poolId, n: sql<number>`count(*)` })
    .from(siteDirectory).groupBy(siteDirectory.poolId)
  return Object.fromEntries(rows.map(r => [r.poolId, Number(r.n)]))
}
