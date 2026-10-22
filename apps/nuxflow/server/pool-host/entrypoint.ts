// The private admin entrypoint of a member pool (server/utils/control-plane.ts), exported
// from the Worker by server/cloudflare-entry.ts. It isn't reachable from the internet: only
// a Worker with a service binding to this one (the platform's control plane — see
// server/utils/pools.ts) can call it, the same way the control plane would call any of
// its own functions. The logic is in server/utils/pool-admin.ts.
import { WorkerEntrypoint } from 'cloudflare:workers'
import { createSystemEvent } from '../utils/system-event'
import { useDb, type Db } from '../utils/db'
import { ensureMigrations } from '../middleware/00.migrate'
import { poolSites, poolStatus, receivePlatformSettings, type PushedSettings } from '../utils/pool-admin'

export class NuxflowPoolAdmin extends WorkerEntrypoint<Record<string, unknown>> {
  private async run<T>(name: string, fn: (db: Db) => Promise<T>): Promise<T> {
    // As in the plugin entrypoints: utilities reading the env without an event find it here.
    globalThis.__env__ = this.env as NuxFlowCloudflareEnv
    const event = createSystemEvent({ env: this.env, ctx: this.ctx })
    try {
      // A brand-new pool may hear from its control plane before serving any request.
      await ensureMigrations(event)
      return await fn(useDb(event))
    } catch (err) {
      console.error(`[pool-admin] ${name} failed:`, err)
      // A plain Error crosses RPC cleanly; the control plane shows its message.
      // eslint-disable-next-line preserve-caught-error -- no cause across RPC, as in plugin-host/entrypoints.ts
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  }

  status() { return this.run('status', poolStatus) }
  listSites() { return this.run('listSites', poolSites) }
  pushPlatformSettings(payload: PushedSettings) { return this.run('pushPlatformSettings', db => receivePlatformSettings(db, payload)) }
}
