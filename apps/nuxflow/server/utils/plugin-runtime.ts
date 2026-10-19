// Spawns a dynamic plugin's server module with exactly the powers an admin approved.
//
// The plugin runs as a Dynamic Worker (Worker Loader) with no bindings and no network of
// its own. What it gets instead:
//   - `env.NUXFLOW`: a stub of PluginHost (plugin-host/entrypoints.ts) made with
//     `ctx.exports.NuxflowPluginHost({ props })`. The props — site, plugin id, granted
//     permissions — are set here and only the host side can read them, so plugin code can
//     neither forge them nor reach another site's or plugin's data through the stub.
//   - `globalOutbound`: null (no network) unless it was granted `network:` permissions, in
//     which case every fetch() goes through NuxflowPluginEgress, which only lets the
//     approved hosts through (plugin-egress.ts).
// See https://developers.cloudflare.com/dynamic-workers/usage/bindings/ and
// https://developers.cloudflare.com/dynamic-workers/usage/egress-control/.
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb } from './db'
import { spawnPluginWorker, getPluginServerCode, PLUGIN_WORKER_LIMITS } from './cf-plugin-kv'
import { assertCodeIntegrity, computeSha256 } from './plugin-signing'
import { getAccountsHost } from './accounts-origin'
import { networkHostsOf } from '../../shared/lib/plugin-permissions'
import type { PluginEgressProps } from './plugin-egress'

// Paths under this prefix are how NuxFlow itself talks to a plugin (event hooks, see
// plugin-hooks.ts). The public /_nuxflow/ext route refuses them.
export const RESERVED_PLUGIN_PATH_PREFIX = '/__nuxflow'

export interface PluginHostProps {
  siteId: string
  pluginId: string
  permissions: string[]
  /** The site's host name — becomes the host header of the host side's system event. */
  host: string
}

export interface RunnablePlugin {
  id: string
  siteId: string
  serverChecksum: string | null
  grantedPermissions: string[] | null
}

type LoopbackFactory = (opts: { props: unknown }) => unknown

function loopbackExports(event: H3Event): Record<string, LoopbackFactory | undefined> | null {
  const ctx = event.context.cloudflare?.context as { exports?: Record<string, LoopbackFactory | undefined> } | undefined
  return ctx?.exports ?? null
}

async function siteHost(event: H3Event, siteId: string): Promise<string> {
  if (event.context.siteId === siteId && typeof event.context.siteDomain === 'string' && event.context.siteDomain) {
    return event.context.siteDomain
  }
  const site = await useDb(event).query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } })
  return site?.domain ?? 'localhost'
}

// Loader ids whose code this isolate has already fetched and verified (see getPluginWorker).
// Capped like the other isolate caches, since every plugin update makes a new id.
const verifiedLoads = new Set<string>()
const MAX_VERIFIED_LOADS = 1000

async function loadVerifiedServerCode(event: H3Event, plugin: RunnablePlugin): Promise<string> {
  const code = await getPluginServerCode(event, plugin.siteId, plugin.id, plugin.serverChecksum)
  if (!code) throw createError({ statusCode: 503, message: 'Plugin code is not available yet — try again in a minute.' })
  // Verify KV content against the checksum stored in D1 at install time.
  // A mismatch means the KV entry was modified after the signed install — hard stop.
  await assertCodeIntegrity(code, plugin.serverChecksum!, 'server module')
  return code
}

/** The plugin's Dynamic Worker, with its approved capability bindings. */
export async function getPluginWorker(event: H3Event, plugin: RunnablePlugin): Promise<WorkerStub> {
  // Fails closed: a plugin without a recorded checksum never runs (see assertCodeIntegrity).
  if (!plugin.serverChecksum) {
    throw createError({ statusCode: 500, message: 'Plugin server module has no recorded checksum — refusing to execute unverified code.' })
  }
  const permissions = [...(plugin.grantedPermissions ?? [])].sort()
  const exportsObj = loopbackExports(event)
  const hostFactory = exportsObj?.NuxflowPluginHost
  const egressFactory = exportsObj?.NuxflowPluginEgress
  const networkHosts = networkHostsOf(permissions)

  if (!hostFactory || (networkHosts.length > 0 && !egressFactory)) {
    // Only possible on a runtime without ctx.exports (compatibility date before 2025-11-17)
    // or a build that lost the entry's named exports — a plugin then runs with nothing,
    // which is safe, but one that needs its permissions can't work, so say so plainly.
    if (permissions.length > 0) {
      throw createError({ statusCode: 503, message: 'Plugin capabilities are unavailable: this Worker does not expose ctx.exports (check compatibility_date and that the build uses server/cloudflare-entry.ts).' })
    }
  }

  const host = await siteHost(event, plugin.siteId)
  const hostProps: PluginHostProps = { siteId: plugin.siteId, pluginId: plugin.id, permissions, host }
  const egressProps: PluginEgressProps = {
    siteId: plugin.siteId,
    pluginId: plugin.id,
    allowedHosts: networkHosts,
    blockedHosts: [host.split(':')[0]!, getAccountsHost()?.split(':')[0]].filter((h): h is string => Boolean(h)),
  }

  // The loader reuses a Worker by id with whatever bindings it was first built with, so the
  // id covers everything the bindings depend on: site (isolates never shared across
  // tenants), code checksum (an update always gets fresh code) and the granted permissions.
  const bindingsKey = (await computeSha256(JSON.stringify([permissions, host, egressProps.blockedHosts]))).slice(0, 16)
  const cacheId = `${plugin.siteId}:${plugin.id}:${plugin.serverChecksum}:${bindingsKey}`

  // The loader remembers a failed load under its id (seen under wrangler dev: a request
  // made before the code reached KV kept failing after it arrived). Right after an install
  // or update, KV can briefly miss in another location — so the code is fetched and
  // verified *before* its id is handed to the loader, once per isolate per id. A miss then
  // fails just this request and the next one tries again; only verified code is ever cached.
  let code: string | null = null
  if (!verifiedLoads.has(cacheId)) {
    code = await loadVerifiedServerCode(event, plugin)
    if (verifiedLoads.size >= MAX_VERIFIED_LOADS) verifiedLoads.clear()
    verifiedLoads.add(cacheId)
  }

  return spawnPluginWorker(event, cacheId, async () => code ?? await loadVerifiedServerCode(event, plugin), {
    env: hostFactory ? { NUXFLOW: hostFactory({ props: hostProps }) } : undefined,
    globalOutbound: networkHosts.length > 0 && egressFactory ? egressFactory({ props: egressProps }) : null,
  })
}

/** Sends `request` to the plugin's fetch handler. */
export async function invokePlugin(event: H3Event, plugin: RunnablePlugin, request: Request): Promise<Response> {
  const worker = await getPluginWorker(event, plugin)
  // Also enforced on the spawned WorkerLoaderWorkerCode itself (cf-plugin-kv.ts) — the
  // lower of the two wins, so either call site changing later can't drop the bound.
  return worker.getEntrypoint(undefined, { limits: PLUGIN_WORKER_LIMITS }).fetch(request)
}
