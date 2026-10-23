import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { siteDirectory, siteSettings, sites, userSiteRoles } from '@nuxflow/db/schema'
import { isServedCopy } from './move-state'
import { useDb } from './db'
import { getSiteInfo } from './site-info'
import { siteOriginForDomain } from './site-auth'
import { absoluteUrl } from './media-url'
import { getUserSiteRole, hasSuperAdminRole } from './permissions'
import { assertWithinPlan } from './hosting-plans'
import { clearCachedRole } from './role-cache'
import { callPool, poolAdminStub, poolBindings } from './pools'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { upsertUserCopy } from './pool-session'
import type { PoolSignInUser } from './pool-sign-in'

export interface SiteBranding {
  id: string
  name: string
  domain: string
  origin: string
  logoUrl: string | null
  primaryColor: string | null
  allowRegistration: boolean
}

/** A site as the accounts origin sees it, with the signed-in person's role there. */
export interface PoolAccountsSite {
  site: SiteBranding
  role: string | null
}

export interface AccountsSite extends PoolAccountsSite {
  /** The member pool the site lives in, or null for one of this Worker's own sites. */
  poolId: string | null
}

export interface AccountSiteListing {
  id: string
  name: string
  domain: string
  role: string
  origin: string
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i

/**
 * What the accounts origin shows about a site ("Sign in to Acme Bakery", its logo and
 * colour), read from this Worker's own database. Data only — never the site's CSS, theme,
 * or custom code, which is the whole point of signing in somewhere else. Null for an
 * unknown or suspended site.
 */
async function localSiteBranding(event: H3Event, siteId: string): Promise<SiteBranding | null> {
  const site = await getSiteInfo(event, siteId)
  if (!site || site.status === 'suspended' || !isServedCopy(site.moveState)) return null
  const rows = await useDb(event).query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, ['appearance.logo_url', 'theme.primary_color', 'auth.allow_public_registration'])),
    columns: { key: true, value: true },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, unknown>
  const origin = siteOriginForDomain(site.domain)

  const rawLogo = typeof map['appearance.logo_url'] === 'string' ? absoluteUrl(map['appearance.logo_url'], origin) : null
  const logoUrl = rawLogo && /^https?:\/\//i.test(rawLogo) ? rawLogo : null
  const color = typeof map['theme.primary_color'] === 'string' ? map['theme.primary_color'].trim() : ''

  return {
    id: site.id,
    name: site.name,
    domain: site.domain,
    origin,
    logoUrl,
    primaryColor: HEX_COLOR.test(color) ? color : null,
    allowRegistration: map['auth.allow_public_registration'] === 'true' || map['auth.allow_public_registration'] === true,
  }
}

/**
 * A site for the accounts origin's pages — one of this Worker's own, or (on a hosting
 * platform with member pools) one the site directory says lives in a pool, asked of that
 * pool over its private binding. Null when it's unknown, suspended, or its pool can't be
 * reached.
 */
export async function findSiteForAccounts(event: H3Event, siteId: string, userId: string | null): Promise<AccountsSite | null> {
  const local = await localSiteBranding(event, siteId)
  if (local) {
    const role = userId ? (await getUserSiteRole(useDb(event), userId, siteId))?.role ?? null : null
    return { site: local, role, poolId: null }
  }

  const [listed] = await useDb(event).select({ poolId: siteDirectory.poolId }).from(siteDirectory)
    .where(eq(siteDirectory.poolSiteId, siteId)).limit(1)
  const stub = listed ? poolAdminStub(event, listed.poolId) : null
  if (!listed || !stub) return null
  try {
    const found = await callPool(stub.siteForAccounts({ protocol: POOL_PROTOCOL, siteId, userId }), `pool ${listed.poolId}`)
    return found ? { ...found, poolId: listed.poolId } : null
  } catch (err) {
    console.error(`[accounts] Couldn't reach pool ${listed.poolId} for site ${siteId}:`, err)
    return null
  }
}

export async function getSiteBranding(event: H3Event, siteId: string): Promise<SiteBranding | null> {
  return (await findSiteForAccounts(event, siteId, null))?.site ?? null
}

/**
 * Makes the signed-in person a member of a site with public registration open — an
 * existing account "registering" (authorize `join`). Does nothing for someone who already
 * has a role there, or for the platform operator.
 */
export async function joinSiteAsMember(event: H3Event, found: AccountsSite, user: PoolSignInUser): Promise<void> {
  const db = useDb(event)
  const platformOperator = await hasSuperAdminRole(db, user.id)
  if (found.poolId) {
    const stub = poolAdminStub(event, found.poolId)
    if (!stub) throw createError({ statusCode: 503, message: 'This site can\'t be reached right now' })
    await callPool(stub.joinSite({ protocol: POOL_PROTOCOL, siteId: found.site.id, user, platformOperator }), `pool ${found.poolId}`)
    return
  }
  await addMemberRole(event, found.site, user.id, platformOperator)
}

async function addMemberRole(event: H3Event, site: SiteBranding, userId: string, platformOperator: boolean): Promise<boolean> {
  const db = useDb(event)
  if (platformOperator || await getUserSiteRole(db, userId, site.id)) return false
  if (!site.allowRegistration) throw forbidden('This site isn\'t accepting new members')
  await assertWithinPlan(event, 'members', 1, site.id)
  await db.insert(userSiteRoles).values({ id: ulid(), userId, siteId: site.id, role: 'member' }).onConflictDoNothing()
  clearCachedRole(userId, site.id)
  return true
}

/** The sites a user belongs to on this Worker. */
async function localUserSites(event: H3Event, userId: string): Promise<AccountSiteListing[]> {
  const rows = await useDb(event).select({
    id: sites.id,
    name: sites.name,
    domain: sites.domain,
    status: sites.status,
    moveState: sites.moveState,
    role: userSiteRoles.role,
  })
    .from(userSiteRoles)
    .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
    .where(eq(userSiteRoles.userId, userId))
  return rows
    .filter(r => r.status !== 'suspended' && isServedCopy(r.moveState))
    .map(r => ({ id: r.id, name: r.name, domain: r.domain, role: r.role, origin: siteOriginForDomain(r.domain) }))
}

/** The sites a user belongs to, for the accounts home page — this Worker's and every pool's. */
export async function listUserSites(event: H3Event, userId: string): Promise<AccountSiteListing[]> {
  const fromPools = await Promise.all(poolBindings(event).map(async ({ binding, stub }) => {
    try {
      return await callPool(stub.userSites({ protocol: POOL_PROTOCOL, userId }), binding)
    } catch (err) {
      console.error(`[accounts] Couldn't list ${binding}'s sites for a user:`, err)
      return []
    }
  }))
  return [...await localUserSites(event, userId), ...fromPools.flat()]
}

// ── Answers a member pool gives its control plane (NuxflowPoolAdmin) ─────────────────

export async function poolSiteForAccounts(event: H3Event, input: { protocol: number; siteId: string; userId: string | null }): Promise<PoolAccountsSite | null> {
  assertCompatibleProtocol(input.protocol)
  const found = await findSiteForAccounts(event, input.siteId, input.userId)
  return found && !found.poolId ? { site: found.site, role: found.role } : null
}

export async function poolJoinSite(event: H3Event, input: { protocol: number; siteId: string; user: PoolSignInUser; platformOperator: boolean }): Promise<{ joined: boolean }> {
  assertCompatibleProtocol(input.protocol)
  const site = await localSiteBranding(event, input.siteId)
  if (!site) throw notFound('This site isn\'t available')
  // The person's copy first: the role row points at it.
  await upsertUserCopy(useDb(event), input.user)
  return { joined: await addMemberRole(event, site, input.user.id, input.platformOperator) }
}

export async function poolUserSites(event: H3Event, input: { protocol: number; userId: string }): Promise<AccountSiteListing[]> {
  assertCompatibleProtocol(input.protocol)
  return localUserSites(event, input.userId)
}
