// The private admin entrypoint of a member pool (server/utils/control-plane.ts), exported
// from the Worker by server/cloudflare-entry.ts. It isn't reachable from the internet: only
// a Worker with a service binding to this one (the platform's control plane — see
// server/utils/pools.ts) can call it, the same way the control plane would call any of
// its own functions. The logic is in server/utils/pool-admin.ts and, for the accounts
// origin's pages, server/utils/accounts-sites.ts.
import type { H3Event } from 'h3'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { createSystemEvent } from '../utils/system-event'
import { useDb } from '../utils/db'
import { ensureMigrations } from '../utils/migrations'
import { poolSites, poolStatus, receivePlatformSettings, type PushedSettings } from '../utils/pool-admin'
import { poolJoinSite, poolSiteForAccounts, poolUserSites } from '../utils/accounts-sites'
import { poolAccountDeletionCheck, poolDeleteAccount, poolExportUserData } from '../utils/account-data'
import { poolCreateSite, poolDeleteSite, poolGetSite, poolSetPlans, poolUpdateSite } from '../utils/pool-sites'
import { poolMonthlyUsage, poolSiteUsage } from '../utils/usage-report'
import { poolInboundRecipient, poolReceiveEmail } from '../utils/inbound-email'
import { poolPendingDomains, poolSiteDomains } from '../utils/hosting-domains'
import { poolSiteMove } from '../utils/site-move'

type Input<F> = F extends (event: H3Event, input: infer I) => unknown ? I : never

export class NuxflowPoolAdmin extends WorkerEntrypoint<Record<string, unknown>> {
  private async run<T>(name: string, fn: (event: H3Event) => Promise<T>, siteId?: string): Promise<T> {
    // As in the plugin entrypoints: utilities reading the env without an event find it here.
    globalThis.__env__ = this.env as NuxFlowCloudflareEnv
    const event = createSystemEvent({ env: this.env, ctx: this.ctx, siteId })
    try {
      // A brand-new pool may hear from its control plane before serving any request.
      await ensureMigrations(event)
      return await fn(event)
    } catch (err) {
      console.error(`[pool-admin] ${name} failed:`, err)
      // A plain Error crosses RPC cleanly; the control plane shows its message.
      // eslint-disable-next-line preserve-caught-error -- no cause across RPC, as in plugin-host/entrypoints.ts
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  }

  status() { return this.run('status', e => poolStatus(useDb(e))) }
  listSites() { return this.run('listSites', e => poolSites(useDb(e))) }
  pushPlatformSettings(payload: PushedSettings) { return this.run('pushPlatformSettings', e => receivePlatformSettings(useDb(e), payload)) }
  siteForAccounts(input: Input<typeof poolSiteForAccounts>) { return this.run('siteForAccounts', e => poolSiteForAccounts(e, input), input?.siteId) }
  joinSite(input: Input<typeof poolJoinSite>) { return this.run('joinSite', e => poolJoinSite(e, input), input?.siteId) }
  userSites(input: Input<typeof poolUserSites>) { return this.run('userSites', e => poolUserSites(e, input)) }
  accountDeletionCheck(input: Input<typeof poolAccountDeletionCheck>) { return this.run('accountDeletionCheck', e => poolAccountDeletionCheck(e, input)) }
  deleteAccount(input: Input<typeof poolDeleteAccount>) { return this.run('deleteAccount', e => poolDeleteAccount(e, input)) }
  exportUserData(input: Input<typeof poolExportUserData>) { return this.run('exportUserData', e => poolExportUserData(e, input)) }
  createSite(input: Input<typeof poolCreateSite>) { return this.run('createSite', e => poolCreateSite(e, input)) }
  updateSite(input: Input<typeof poolUpdateSite>) { return this.run('updateSite', e => poolUpdateSite(e, input)) }
  deleteSite(input: Input<typeof poolDeleteSite>) { return this.run('deleteSite', e => poolDeleteSite(e, input)) }
  setPlans(input: Input<typeof poolSetPlans>) { return this.run('setPlans', e => poolSetPlans(e, input)) }
  getSite(input: Input<typeof poolGetSite>) { return this.run('getSite', e => poolGetSite(e, input)) }
  monthlyUsage(input: Input<typeof poolMonthlyUsage>) { return this.run('monthlyUsage', e => poolMonthlyUsage(e, input)) }
  siteUsage(input: Input<typeof poolSiteUsage>) { return this.run('siteUsage', e => poolSiteUsage(e, input)) }
  inboundRecipient(input: Input<typeof poolInboundRecipient>) { return this.run('inboundRecipient', e => poolInboundRecipient(e, input)) }
  receiveEmail(input: Input<typeof poolReceiveEmail>) { return this.run('receiveEmail', e => poolReceiveEmail(e, input)) }
  siteDomains(input: Input<typeof poolSiteDomains>) { return this.run('siteDomains', e => poolSiteDomains(e, input), input?.siteId) }
  pendingDomains(input: Input<typeof poolPendingDomains>) { return this.run('pendingDomains', e => poolPendingDomains(e, input)) }
  siteMove(input: Input<typeof poolSiteMove>) { return this.run('siteMove', e => poolSiteMove(e, input)) }
}
