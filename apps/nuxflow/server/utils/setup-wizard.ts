import { ulid } from 'ulid'
import { and, count, eq, ne } from 'drizzle-orm'
import { accounts, contentItems, contentTypes, sites, siteSettings, taxonomies, users, userSiteRoles } from '@nuxflow/db/schema'
import type { Db } from './db'
import { sha256Hex } from './buffer'
import { nuxflowPasswordHasher } from './pw'
import { badRequest, conflict, forbidden, notFound } from './response'

// The database steps of POST /api/v1/setup/complete (the setup wizard). The route decides
// their order — see the comments there for why each comes where it does.

export type SetupSiteFields = { name: string; locale: string; timezone: string }
export type SetupAdminFields = { name: string; email: string; password: string }

/**
 * Resolves the completing admin before anything is written, and returns the existing
 * account's id (or null for a new account). An existing account's password is required
 * rather than trusted by email alone: accounts are global, and granting this site's top
 * role to whatever account already holds an email would hand it to anyone who registered
 * that address first.
 */
export async function authenticateSetupAdmin(db: Db, admin: SetupAdminFields): Promise<string | null> {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, admin.email),
    columns: { id: true },
  })
  if (existingUser) {
    const credential = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, existingUser.id), eq(accounts.providerId, 'credential')),
      columns: { password: true },
    })
    const passwordOk = Boolean(credential?.password && admin.password)
      && await nuxflowPasswordHasher.verify({ hash: credential!.password!, password: admin.password })
    if (!passwordOk) {
      forbidden('An account with this email already exists. Enter that account\'s current password to continue, or use "Forgot password" on the login page first.')
    }
    return existingUser.id
  }
  if (!admin.name || !admin.password || admin.password.length < 8) {
    badRequest('A name and password of at least 8 characters are required for new accounts.')
  }
  return null
}

/** The first-ever install: no site or no user exists yet. */
export async function isInitialInstall(db: Db): Promise<boolean> {
  const [siteCount] = await db.select({ value: count() }).from(sites)
  const [userCount] = await db.select({ value: count() }).from(users)
  return (siteCount?.value ?? 0) === 0 || (userCount?.value ?? 0) === 0
}

/**
 * The first-ever install's site, at `host`: reuses (and clears the stale seeded data of)
 * a site already recorded there, otherwise creates one. It's the operator's own
 * (`sites.is_primary`).
 */
export async function prepareInitialSite(db: Db, host: string, site: SetupSiteFields): Promise<string> {
  const existingSite = await db.query.sites.findFirst({
    where: eq(sites.domain, host),
  })

  if (existingSite) {
    const siteId = existingSite.id
    // Clear any stale seeded data associated with this site to avoid duplicates/integrity errors
    // Delete child/referencing tables first to respect foreign key constraints
    await db.delete(contentItems).where(eq(contentItems.siteId, siteId))
    await db.delete(contentTypes).where(eq(contentTypes.siteId, siteId))
    await db.delete(taxonomies).where(eq(taxonomies.siteId, siteId))
    await db.delete(siteSettings).where(eq(siteSettings.siteId, siteId))
    await db.delete(userSiteRoles).where(eq(userSiteRoles.siteId, siteId))

    // Clear any stale primary flag first — the unique index allows only one.
    await db.update(sites).set({ isPrimary: false }).where(ne(sites.id, siteId))
    await db.update(sites)
      .set({
        name: site.name,
        locale: site.locale,
        timezone: site.timezone,
        status: 'active',
        setupCompleted: true,
        isPrimary: true,
      })
      .where(eq(sites.id, siteId))
    return siteId
  }

  const siteId = ulid()
  await db.insert(sites).values({
    id: siteId,
    name: site.name,
    domain: host,
    locale: site.locale,
    timezone: site.timezone,
    status: 'active',
    setupCompleted: true,
    isPrimary: !(await db.query.sites.findFirst({ where: eq(sites.isPrimary, true), columns: { id: true } })),
  })
  return siteId
}

/**
 * A secondary site pre-created by a super admin (Super Admin → Sites), found by the
 * request host — its domain was set then, not from the setup form. Claims it with the
 * one-time setup token and burns the token.
 */
export async function claimSecondarySite(db: Db, host: string, site: SetupSiteFields, setupToken: string | undefined): Promise<string> {
  const existing = await db.query.sites.findFirst({
    where: eq(sites.domain, host),
  })

  if (!existing) {
    notFound(`Site for domain ${host} not found.`)
  }

  if (existing.setupCompleted) {
    conflict('Setup already completed for this site.')
  }

  // Secondary sites can only be claimed with the one-time token issued when the super
  // admin created the site record — completing setup grants the site's top role, so this
  // must never be reachable by an unauthenticated request that merely knows the domain.
  if (!existing.setupTokenHash) {
    forbidden('This site has no setup link. Ask a super admin to generate one.')
  }
  if (!setupToken) {
    forbidden('Invalid or missing setup token.')
  }

  const providedTokenHash = await sha256Hex(setupToken)

  // Claim the token and burn it in one atomic, conditional statement — the WHERE clause
  // re-checks setupTokenHash against the *current* row, not the value read a moment ago.
  // Two concurrent requests both carrying a valid (e.g. leaked/observed) token would
  // otherwise both pass the earlier read-based check and both proceed to seed content
  // and grant a role, before either write landed. D1 serialises this single UPDATE,
  // so only one request's WHERE clause can match — `.returning()` (portable across the
  // D1 and libSQL/better-sqlite3 drivers, unlike D1's own `.meta.changes`) comes back
  // empty for the request that lost the race, which is rejected exactly like a token
  // that was already burned.
  const claimed = await db.update(sites)
    .set({
      name: site.name,
      locale: site.locale,
      timezone: site.timezone,
      setupCompleted: true,
      setupTokenHash: null,
    })
    .where(and(eq(sites.id, existing.id), eq(sites.setupTokenHash, providedTokenHash)))
    .returning({ id: sites.id })

  if (claimed.length === 0) {
    forbidden('Invalid or missing setup token.')
  }
  return existing.id
}

/** Initial site settings from the wizard's choices. */
/** `emailProvider` null = store none (the env default, or the server log, applies). */
export async function saveSetupSettings(db: Db, siteId: string, emailProvider: string | null): Promise<void> {
  await db.insert(siteSettings).values([
    ...(emailProvider ? [{ id: ulid(), siteId, key: 'email.provider', value: emailProvider }] : []),
    { id: ulid(), siteId, key: 'frontend.show_header', value: false },
  ])
}

/** Creates the admin's account directly (email verified, password credential). */
export async function createSetupAdminAccount(db: Db, admin: SetupAdminFields): Promise<string> {
  const userId = ulid()
  const passwordHash = await nuxflowPasswordHasher.hash(admin.password)

  await db.insert(users).values({
    id: userId,
    name: admin.name,
    email: admin.email,
    emailVerified: true,
  })

  await db.insert(accounts).values({
    id: ulid(),
    accountId: userId,
    providerId: 'credential',
    // Must match Better Auth's own createLocalAccountIssuer('credential') —
    // sign-in looks accounts up by (issuer, accountId), not providerId.
    issuer: 'local:credential',
    userId,
    password: passwordHash,
  })
  return userId
}

/** Gives the admin `role` on the site, unless they already have a role there. */
export async function grantSetupRole(db: Db, userId: string, siteId: string, role: 'super_admin' | 'admin'): Promise<void> {
  const existingRole = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.siteId, siteId)),
  })
  if (!existingRole) {
    await db.insert(userSiteRoles).values({ id: ulid(), userId, siteId, role })
  }
}
