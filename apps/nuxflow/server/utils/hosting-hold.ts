import type { H3Event } from 'h3'
import { and, eq, inArray, or } from 'drizzle-orm'
import { hostingSubscriptions, sites } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { getPoolId, isMemberPool } from './control-plane'
import { isHostingPlatform } from './hosting-platform'
import { isSuperAdminOnSite } from './permissions'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { callControlPlane } from './pool-session'
import { forbidden } from './response'

/**
 * Stops a hosting customer reopening a site they've stopped paying for. A site paused for
 * non-payment is in maintenance mode, where /admin and /api stay open so the customer can
 * sign in, pay and take a backup, so Settings could otherwise switch it straight back on.
 */

/** Stripe statuses where NuxFlow pauses the site (hosting-billing.ts). */
export const ENDED_SUBSCRIPTION_STATUSES = ['paused', 'unpaid', 'canceled', 'incomplete_expired']

/**
 * Whether billing is why this site is closed. The flag alone isn't enough: billing only sets
 * it on a site that was active, so a customer who chose maintenance mode just before the
 * subscription ended has no flag, and the subscription's status is what catches that.
 * Reads the control plane's data: subscriptions never live in a pool.
 */
export async function isSiteHeldForNonPayment(db: Db, siteId: string): Promise<boolean> {
  if (!(await isHostingPlatform(db))) return false
  const row = await db.query.hostingSubscriptions.findFirst({
    where: and(
      eq(hostingSubscriptions.hostedSiteId, siteId),
      or(
        eq(hostingSubscriptions.pausedForNonPayment, true),
        inArray(hostingSubscriptions.status, ENDED_SUBSCRIPTION_STATUSES),
      ),
    ),
    columns: { id: true },
  })
  return Boolean(row)
}

/** The control plane's answer to a pool asking about one of its sites (NuxflowControlPlane). */
export async function siteBillingHold(db: Db, input: { protocol: number; siteId: string }): Promise<boolean> {
  assertCompatibleProtocol(input.protocol)
  return isSiteHeldForNonPayment(db, input.siteId)
}

/**
 * In a pool a failed lookup lets the change through. Release rings mean a pool can run ahead
 * of a control plane that doesn't have this call yet, and refusing then would stop every
 * site admin in that pool leaving maintenance mode for days. An attacker can't cause the
 * failure, and billing's own emails and the operator's notice still went out.
 */
async function heldForNonPayment(event: H3Event, siteId: string): Promise<boolean> {
  if (!isMemberPool()) return isSiteHeldForNonPayment(useDb(event), siteId)
  try {
    return await callControlPlane(event, cp => cp.siteBillingHold({ protocol: POOL_PROTOCOL, poolId: getPoolId()!, siteId }))
  }
  catch (err) {
    console.error('[hosting-hold] Could not ask the control plane about billing:', err)
    return false
  }
}

/** Refuses a site admin taking a site out of maintenance while its hosting is unpaid. The operator still can. */
export async function assertSiteMayReopen(event: H3Event, siteId: string, userId: string): Promise<void> {
  const db = useDb(event)
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { status: true } })
  if (site?.status === 'active') return
  if (await isSuperAdminOnSite(db, userId, siteId)) return
  if (await heldForNonPayment(event, siteId)) {
    forbidden('This site is paused because its hosting isn\'t paid. Sort out the payment under Billing in My hosting and it reopens by itself.', { code: 'hosting_unpaid' })
  }
}
