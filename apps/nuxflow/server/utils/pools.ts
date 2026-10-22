import type { H3Event } from 'h3'
import { count } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { getPlatformSetting, POOL_PLATFORM_SETTINGS, type PlatformSettingKey } from './control-plane'
import { POOL_PROTOCOL, assertCompatibleProtocol, type PoolSite, type PoolStatus, type PushedSettings } from './pool-admin'
import { errorMessage } from './errors'
import { poolBindingName } from '../../shared/lib/pool-id'
import type { PoolSignInUser } from './pool-sign-in'
import type { AccountSiteListing, PoolAccountsSite } from './accounts-sites'

/**
 * The control plane's view of its member pools (control-plane.ts). A pool is connected by
 * adding a service binding to the control plane's wrangler config, named after the pool —
 * `pnpm pool:create` prints it:
 *
 *   [[services]]
 *   binding = "POOL_CLIENTX"
 *   service = "nuxflow-pool-clientx"
 *   entrypoint = "NuxflowPoolAdmin"
 *
 * The bindings are the list of pools: nothing else needs registering, and a pool can't be
 * "known" without the control plane being able to reach it. Calls go to the pool's private
 * admin entrypoint (pool-admin.ts), never over the internet.
 */

export const POOL_BINDING_RE = /^POOL_[A-Z0-9_]+$/

export interface PoolAdminStub {
  status(): Promise<PoolStatus>
  listSites(): Promise<PoolSite[]>
  pushPlatformSettings(payload: PushedSettings): Promise<{ stored: number }>
  // Sign-in across pools (accounts-sites.ts): what the accounts origin shows and does for a pool's site.
  siteForAccounts(input: { protocol: number; siteId: string; userId: string | null }): Promise<PoolAccountsSite | null>
  joinSite(input: { protocol: number; siteId: string; user: PoolSignInUser; platformOperator: boolean }): Promise<{ joined: boolean }>
  userSites(input: { protocol: number; userId: string }): Promise<AccountSiteListing[]>
}

/** The admin stub of the pool with this id, if this Worker has a binding to it. */
export function poolAdminStub(event: H3Event, poolId: string): PoolAdminStub | null {
  return poolBindings(event).find(p => p.binding === poolBindingName(poolId))?.stub ?? null
}

/** Pool calls must not hang a page: rejects after 10 s. */
export function callPool<T>(promise: Promise<T>, what: string): Promise<T> {
  return withTimeout(promise, what)
}

/** Every pool binding on this Worker, in name order. */
export function poolBindings(event: H3Event): { binding: string; stub: PoolAdminStub }[] {
  const env = (event.context.cloudflare?.env ?? {}) as unknown as Record<string, unknown>
  return Object.keys(env)
    .filter(name => POOL_BINDING_RE.test(name) && env[name] != null && typeof env[name] === 'object')
    .sort()
    .map(binding => ({ binding, stub: env[binding] as PoolAdminStub }))
}

// A pool that doesn't answer must not hang the Pools page or a settings save.
const CALL_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} didn't answer within ${CALL_TIMEOUT_MS / 1000} s`)), CALL_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export interface PoolReport {
  binding: string
  /** null when the pool couldn't be reached. */
  status: PoolStatus | null
  sites: PoolSite[]
  error: string | null
}

export async function describePools(event: H3Event): Promise<PoolReport[]> {
  return Promise.all(poolBindings(event).map(async ({ binding, stub }): Promise<PoolReport> => {
    try {
      const [status, sites] = await Promise.all([
        withTimeout(stub.status(), binding),
        withTimeout(stub.listSites(), binding),
      ])
      assertCompatibleProtocol(status?.protocol)
      if (!status.poolId) return { binding, status, sites, error: `${binding} points at a Worker that isn't a member pool (no NUXT_POOL_ID).` }
      return { binding, status, sites, error: null }
    } catch (err) {
      return { binding, status: null, sites: [], error: errorMessage(err, `Couldn't reach ${binding}`) }
    }
  }))
}

/** This Worker's own line on the Pools page. */
export async function controlPlaneSummary(db: Db): Promise<{ commit: string | null; release: string | null; siteCount: number }> {
  const config = useRuntimeConfig()
  const [row] = await db.select({ n: count() }).from(sites)
  return {
    commit: config.buildCommit ? String(config.buildCommit) : null,
    release: config.buildRelease ? String(config.buildRelease) : null,
    siteCount: row?.n ?? 0,
  }
}

/** Every platform setting as the control plane has it, for sending to pools. */
export async function collectPlatformSettings(db: Db): Promise<Record<string, string | null>> {
  const keys = Object.keys(POOL_PLATFORM_SETTINGS) as PlatformSettingKey[]
  const values = await Promise.all(keys.map(key => getPlatformSetting(db, key)))
  return Object.fromEntries(keys.map((key, i) => [key, values[i] ?? null]))
}

export interface PushResult {
  binding: string
  ok: boolean
  error: string | null
}

/**
 * Sends the platform settings to every pool. Called when Super Admin → Platform saves, and
 * from the Pools page (e.g. after connecting a new pool). Never throws: one unreachable
 * pool doesn't stop the others, and the results say which failed.
 */
export async function pushSettingsToPools(event: H3Event): Promise<PushResult[]> {
  const bindings = poolBindings(event)
  if (!bindings.length) return []
  const payload: PushedSettings = { protocol: POOL_PROTOCOL, settings: await collectPlatformSettings(useDb(event)) }
  return Promise.all(bindings.map(async ({ binding, stub }): Promise<PushResult> => {
    try {
      await withTimeout(stub.pushPlatformSettings(payload), binding)
      return { binding, ok: true, error: null }
    } catch (err) {
      const error = errorMessage(err, `Couldn't reach ${binding}`)
      console.error(`[pools] Sending platform settings to ${binding} failed:`, error)
      return { binding, ok: false, error }
    }
  }))
}

/**
 * Orders release names (`ring1-2026-10-22`, `ring2-2026-10-24-2`, from the release
 * scripts) by date and same-day number, ignoring the ring. Anything else sorts first.
 */
export function releaseSortKey(release: string | null): string {
  const m = /-(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(release ?? '')
  return m ? `${m[1]}-${String(m[2] ?? 1).padStart(4, '0')}` : ''
}
