// The control plane's private entrypoint for its member pools (server/utils/control-plane.ts),
// exported from the Worker by server/cloudflare-entry.ts. Only a Worker with a service
// binding to this one can call it — each pool's `CONTROL_PLANE` binding, which
// `pnpm pool:create` writes into the pool's config. The logic is in
// server/utils/pool-sign-in.ts.
import type { H3Event } from 'h3'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { createSystemEvent } from '../utils/system-event'
import { useDb, type Db } from '../utils/db'
import { isMemberPool } from '../utils/control-plane'
import { ensureMigrations } from '../middleware/00.migrate'
import { endSession, provisionAccount, redeemSignInCode, sendSetPasswordEmailForPool, sessionStatus } from '../utils/pool-sign-in'

type DbInput<F> = F extends (db: Db, input: infer I) => unknown ? I : never
type EventInput<F> = F extends (event: H3Event, input: infer I) => unknown ? I : never

export class NuxflowControlPlane extends WorkerEntrypoint<Record<string, unknown>> {
  private async run<T>(name: string, fn: (event: H3Event) => Promise<T>): Promise<T> {
    globalThis.__env__ = this.env as NuxFlowCloudflareEnv
    try {
      // A member pool has no accounts to answer for — a binding pointing at one is a mistake.
      if (isMemberPool()) throw new Error('This Worker is a member pool, not a control plane.')
      const event = createSystemEvent({ env: this.env, ctx: this.ctx })
      await ensureMigrations(event)
      return await fn(event)
    } catch (err) {
      console.error(`[control-plane] ${name} failed:`, err)
      // eslint-disable-next-line preserve-caught-error -- no cause across RPC, as in plugin-host/entrypoints.ts
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  }

  redeemSignInCode(input: DbInput<typeof redeemSignInCode>) { return this.run('redeemSignInCode', e => redeemSignInCode(useDb(e), input)) }
  sessionStatus(input: DbInput<typeof sessionStatus>) { return this.run('sessionStatus', e => sessionStatus(useDb(e), input)) }
  endSession(input: DbInput<typeof endSession>) { return this.run('endSession', e => endSession(useDb(e), input)) }
  provisionAccount(input: EventInput<typeof provisionAccount>) { return this.run('provisionAccount', e => provisionAccount(e, input)) }
  sendSetPasswordEmail(input: EventInput<typeof sendSetPasswordEmailForPool>) { return this.run('sendSetPasswordEmail', e => sendSetPasswordEmailForPool(e, input)) }
}
