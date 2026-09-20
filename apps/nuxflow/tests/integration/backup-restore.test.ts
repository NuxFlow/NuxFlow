/**
 * Integration tests for the NuxFlow backup/restore utilities:
 *   buildBackup()  — server/utils/backup.ts (used by GET /api/v1/backup)
 *   applyBackup()  — server/utils/backup.ts (used by POST /api/v1/restore and
 *                    the theme demo-import route)
 *
 * These exercise the core export/import logic directly rather than the HTTP
 * handlers, since the HTTP layer's multipart/zip parsing isn't covered by the
 * mock-event test harness. That's where the actual data-shape bugs live.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedContentType, seedContentItem, seedTier } from '../helpers/seed'
import { taxonomies, taxonomyTerms, contentTaxonomyTerms, contentItems, menus, forms, siteSettings, themes, dynamicPlugins, users, userSiteRoles, membershipTiers } from '@nuxflow/db/schema'
import { eq, and } from 'drizzle-orm'
import { ulid } from 'ulid'
import { resolveSetting, saveSetting } from '../../server/utils/settings'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// Themes/dynamic plugins keep their real payload only in KV (see cf-env.ts) — this fakes
// that store with a plain Map, keyed the same way the real KV helpers key it, so
// buildBackup()/applyBackup() round-trip through it exactly like production without
// needing a real KVNamespace.
const kvStore = new Map<string, string>()
vi.mock('../../server/utils/cf-env', () => ({
  getThemeCSS: async (_event: unknown, siteId: string, themeId: string) => kvStore.get(`theme:${siteId}:${themeId}:css`) ?? null,
  putThemeCSS: async (_event: unknown, siteId: string, themeId: string, css: string) => { kvStore.set(`theme:${siteId}:${themeId}:css`, css) },
  getThemeDemo: async (_event: unknown, siteId: string, themeId: string) => kvStore.get(`theme:${siteId}:${themeId}:demo`) ?? null,
  putThemeDemo: async (_event: unknown, siteId: string, themeId: string, json: string) => { kvStore.set(`theme:${siteId}:${themeId}:demo`, json) },
  getPluginServerCode: async (_event: unknown, siteId: string, pluginId: string) => kvStore.get(`plugin:${siteId}:${pluginId}:server`) ?? null,
  putPluginServerCode: async (_event: unknown, siteId: string, pluginId: string, code: string) => { kvStore.set(`plugin:${siteId}:${pluginId}:server`, code) },
  getPluginClientBundle: async (_event: unknown, siteId: string, pluginId: string) => kvStore.get(`plugin:${siteId}:${pluginId}:client`) ?? null,
  putPluginClientBundle: async (_event: unknown, siteId: string, pluginId: string, bundle: string) => { kvStore.set(`plugin:${siteId}:${pluginId}:client`, bundle) },
}))

// Deterministic stand-ins for real Ed25519/SHA-256 so tests can flip a signature "invalid"
// without generating real keys — plugin-signing.ts itself is exercised by its own unit tests.
vi.mock('../../server/utils/plugin-signing', () => ({
  computeSha256: async (data: string) => `sha-${data}`,
  verifyPluginSignature: async (_key: string, _payload: unknown, signature: string) => signature === 'valid-signature',
}))

// findOrCreateUserAccount() (used by the 'users' restore section) calls
// auth.api.signUpEmail() for an email with no existing account — simulate that by
// actually inserting the user row it expects to find afterward, same as a real
// Better Auth sign-up would leave behind.
const mockRequestPasswordReset = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({
    api: {
      signUpEmail: async ({ body }: { body: { name: string; email: string } }) => {
        await getCurrentTestDb().insert(users).values({ id: ulid(), name: body.name, email: body.email, emailVerified: false })
      },
      requestPasswordReset: mockRequestPasswordReset,
    },
  }),
  clearBetterAuthCache: vi.fn(),
}))

const { buildBackup, applyBackup, parseBackupJson } = await import('../../server/utils/backup')

const SOURCE_SITE = 'site-backup-src-01'
const TARGET_SITE = 'site-backup-dst-01'
const REJECT_SITE = 'site-backup-dst-02'

let sourceTypeId: string
let newsTermId: string
let updatesTermId: string
let postId: string
let sourceThemeId: string
let sourceEditorId: string

function mkEvent(siteId: string) {
  return createMockEvent({ siteId }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SOURCE_SITE, domain: 'backup-src.localhost' })
  await seedSite(db, { id: TARGET_SITE, domain: 'backup-dst.localhost' })
  await seedSite(db, { id: REJECT_SITE, domain: 'backup-dst2.localhost' })
  await seedUser(db, { id: 'user-backup-01', email: 'backup@test.com' })

  sourceTypeId = await seedContentType(db, SOURCE_SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })

  const taxId = ulid()
  await db.insert(taxonomies).values({ id: taxId, siteId: SOURCE_SITE, slug: 'category', name: 'Category' })
  newsTermId = ulid()
  updatesTermId = ulid()
  await db.insert(taxonomyTerms).values([
    { id: newsTermId, taxonomyId: taxId, slug: 'news', name: 'News' },
    { id: updatesTermId, taxonomyId: taxId, slug: 'updates', name: 'Updates' },
  ])

  postId = await seedContentItem(db, SOURCE_SITE, sourceTypeId, {
    slug: 'hello-world',
    title: 'Hello World',
    status: 'published',
    excerpt: 'An excerpt',
  })
  await db.insert(contentTaxonomyTerms).values({ contentItemId: postId, termId: newsTermId })

  await db.insert(menus).values({
    id: ulid(), siteId: SOURCE_SITE, name: 'Main Menu', location: 'header',
    items: [{ label: 'Home', url: '/' }],
  })

  await db.insert(forms).values({
    id: ulid(), siteId: SOURCE_SITE, slug: 'contact', name: 'Contact Us',
    fields: [{ key: 'email', type: 'email', label: 'Email' }],
    notifications: {}, redirectUrl: null, status: 'active',
  })

  // A plain setting and a sensitive one — saveSetting() encrypts the sensitive one.
  await saveSetting(mkEvent(SOURCE_SITE), 'seo.meta_title', 'My Site')
  await saveSetting(mkEvent(SOURCE_SITE), 'payments.stripe_secret_key', 'sk_test_supersecret123')

  // A theme with CSS living only in KV, and a signed dynamic plugin with server code
  // living only in KV — see the cf-env.ts mock above for the fake KV backing it.
  sourceThemeId = ulid()
  await db.insert(themes).values({
    id: sourceThemeId, siteId: SOURCE_SITE,
    packageName: '@test/theme', name: 'Test Theme', version: '1.0.0',
    isActive: true, hasCss: true,
  })
  kvStore.set(`theme:${SOURCE_SITE}:${sourceThemeId}:css`, '.test{color:red}')

  await db.insert(dynamicPlugins).values({
    id: 'demo-plugin', siteId: SOURCE_SITE,
    name: 'Demo Plugin', version: '1.0.0', description: 'A demo plugin',
    isActive: true, hasServer: true, hasClient: false,
    serverChecksum: 'sha-server-code', clientChecksum: null,
    publisherPublicKey: 'pub-key-abc', signature: 'valid-signature',
  })
  kvStore.set(`plugin:${SOURCE_SITE}:demo-plugin:server`, 'server-code')

  // A real team member (excluded: super_admin, tested separately below) and a
  // membership tier on the source site, for the users/membershipTiers restore tests.
  sourceEditorId = await seedUser(db, { email: 'editor@backup-src.test', name: 'Source Editor' })
  await db.insert(userSiteRoles).values({ id: ulid(), userId: sourceEditorId, siteId: SOURCE_SITE, role: 'editor' })
  const superAdminId = await seedUser(db, { email: 'superadmin@backup-src.test', name: 'Source Super Admin' })
  await db.insert(userSiteRoles).values({ id: ulid(), userId: superAdminId, siteId: SOURCE_SITE, role: 'super_admin' })

  await seedTier(db, SOURCE_SITE, { name: 'Pro', price: 1999, features: ['Feature A', 'Feature B'] })
})

afterAll(teardownTestDb)

describe('buildBackup()', () => {
  it('exports content with its taxonomy term assignments as slug paths', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const item = backup.content.find(c => c.slug === 'hello-world')
    expect(item).toBeTruthy()
    expect(item!.termSlugs).toEqual(['category/news'])
    expect(item!.excerpt).toBe('An excerpt')
  })

  it('exports menus and forms', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    expect(backup.menus.map(m => m.name)).toContain('Main Menu')
    expect(backup.forms.map(f => f.slug)).toContain('contact')
  })

  it('decrypts sensitive settings back to plaintext for portability', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    expect(backup.settings['seo.meta_title']).toBe('My Site')
    expect(backup.settings['payments.stripe_secret_key']).toBe('sk_test_supersecret123')
  })
})

describe('applyBackup() — first restore onto an empty site', () => {
  it('creates content, taxonomies/terms, menus, forms, and re-encrypts settings', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['content', 'taxonomies', 'menus', 'forms', 'settings'],
      conflictMode: 'skip',
    })

    expect(result.content.created).toBe(1)
    expect(result.taxonomies.created).toBe(1)
    expect(result.terms.created).toBe(2)
    expect(result.menus.created).toBe(1)
    expect(result.forms.created).toBe(1)
    expect(result.settings.updated).toBe(2)

    const db = getCurrentTestDb()
    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, TARGET_SITE), eq(contentItems.slug, 'hello-world')),
    })
    expect(item).toBeTruthy()

    const assignments = await db.query.contentTaxonomyTerms.findMany({
      where: eq(contentTaxonomyTerms.contentItemId, item!.id),
    })
    expect(assignments).toHaveLength(1)

    const secret = await resolveSetting(mkEvent(TARGET_SITE), 'payments.stripe_secret_key')
    expect(secret).toBe('sk_test_supersecret123')

    // Stored ciphertext must not be the plaintext value (round-tripped through
    // saveSetting()'s encryption, not written raw).
    const row = await db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, TARGET_SITE), eq(siteSettings.key, 'payments.stripe_secret_key')),
    })
    expect(row!.value).not.toBe('sk_test_supersecret123')
  })
})

describe('applyBackup() — conflictMode "overwrite" reapplies taxonomy term assignments', () => {
  it('replaces existing term assignments with the backup\'s, not just item fields', async () => {
    const db = getCurrentTestDb()

    // Simulate drift on the target site: the restored item now has "updates"
    // instead of "news" (e.g. an editor recategorized it after the first restore).
    const targetItem = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, TARGET_SITE), eq(contentItems.slug, 'hello-world')),
    })
    const targetTax = await db.query.taxonomies.findFirst({
      where: and(eq(taxonomies.siteId, TARGET_SITE), eq(taxonomies.slug, 'category')),
    })
    const targetUpdatesTerm = await db.query.taxonomyTerms.findFirst({
      where: and(eq(taxonomyTerms.taxonomyId, targetTax!.id), eq(taxonomyTerms.slug, 'updates')),
    })
    await db.delete(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, targetItem!.id))
    await db.insert(contentTaxonomyTerms).values({ contentItemId: targetItem!.id, termId: targetUpdatesTerm!.id })

    // Restore the original backup (termSlugs: ["category/news"]) with overwrite mode.
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['content', 'taxonomies'],
      conflictMode: 'overwrite',
    })

    expect(result.content.updated).toBe(1)
    expect(result.content.created).toBe(0)

    const assignments = await db.query.taxonomyTerms.findMany({
      where: eq(taxonomyTerms.taxonomyId, targetTax!.id),
    })
    const termById = new Map(assignments.map(t => [t.id, t.slug]))

    const finalAssignments = await db.query.contentTaxonomyTerms.findMany({
      where: eq(contentTaxonomyTerms.contentItemId, targetItem!.id),
    })
    const finalSlugs = finalAssignments.map(a => termById.get(a.termId))
    expect(finalSlugs).toEqual(['news'])
  })
})

describe('applyBackup() — conflictMode "archive" keeps both copies', () => {
  it('renames the existing item as a draft backup and inserts the backup content fresh', async () => {
    const db = getCurrentTestDb()
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)

    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['content', 'taxonomies'],
      conflictMode: 'archive',
    })

    expect(result.content.created).toBe(1)

    const items = await db.query.contentItems.findMany({
      where: eq(contentItems.siteId, TARGET_SITE),
    })
    const archived = items.find(i => i.slug.startsWith('hello-world-backup-'))
    const fresh = items.find(i => i.slug === 'hello-world')

    expect(archived).toBeTruthy()
    expect(archived!.status).toBe('draft')
    expect(fresh).toBeTruthy()

    const freshAssignments = await db.query.contentTaxonomyTerms.findMany({
      where: eq(contentTaxonomyTerms.contentItemId, fresh!.id),
    })
    expect(freshAssignments).toHaveLength(1)
  })
})

describe('buildBackup() — themes and dynamic plugins (KV-only payloads)', () => {
  it('includes a theme\'s CSS from KV alongside its D1 row', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const theme = backup.themes.find(t => t.packageName === '@test/theme')
    expect(theme).toBeTruthy()
    expect(theme!.css).toBe('.test{color:red}')
  })

  it('includes a dynamic plugin\'s server code from KV alongside its D1 row', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const plugin = backup.plugins.find(p => p.pluginId === 'demo-plugin')
    expect(plugin).toBeTruthy()
    expect(plugin!.serverCode).toBe('server-code')
    expect(plugin!.signature).toBe('valid-signature')
  })
})

describe('applyBackup() — restoring themes and plugins', () => {
  it('restores a theme\'s CSS to KV and installs it inactive under a new id', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['themes'],
      conflictMode: 'skip',
    })
    expect(result.themes.created).toBe(1)

    const db = getCurrentTestDb()
    const row = await db.query.themes.findFirst({
      where: and(eq(themes.siteId, TARGET_SITE), eq(themes.packageName, '@test/theme')),
    })
    expect(row).toBeTruthy()
    expect(row!.id).not.toBe(sourceThemeId) // regenerated, not copied
    expect(row!.isActive).toBe(false) // never auto-activates over the live theme
    expect(kvStore.get(`theme:${TARGET_SITE}:${row!.id}:css`)).toBe('.test{color:red}')
  })

  it('re-verifies checksum + signature and re-writes KV when recovering a plugin on its own site', async () => {
    // Models the actual motivating scenario: this site's KV namespace lost the plugin's
    // code (wiped/corrupted) but its D1 row survived, and a prior backup still has the
    // code. Restoring onto the SAME site it's already installed on, in 'overwrite' mode,
    // should re-verify and re-write the KV payload without duplicating the D1 row.
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    kvStore.delete(`plugin:${SOURCE_SITE}:demo-plugin:server`) // simulate KV loss

    const result = await applyBackup(mkEvent(SOURCE_SITE), SOURCE_SITE, backup, {
      what: ['plugins'],
      conflictMode: 'overwrite',
    })
    expect(result.plugins.updated).toBe(1)
    expect(result.plugins.created).toBe(0)
    expect(result.plugins.rejected).toBe(0)
    expect(kvStore.get(`plugin:${SOURCE_SITE}:demo-plugin:server`)).toBe('server-code')
  })

  it('skips (does not crash) restoring a plugin already installed on a different site', async () => {
    // dynamicPlugins.id is a globally-unique primary key (the publisher's manifest id,
    // used directly as the KV key segment) — not scoped per site like every other table
    // in this file. SOURCE_SITE still holds 'demo-plugin', so restoring the same backup
    // onto TARGET_SITE can't insert a second row with that id; it must skip cleanly
    // instead of surfacing a raw SQLITE_CONSTRAINT_PRIMARYKEY error.
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['plugins'],
      conflictMode: 'skip',
    })
    expect(result.plugins.skipped).toBe(1)
    expect(result.plugins.created).toBe(0)

    const db = getCurrentTestDb()
    const row = await db.query.dynamicPlugins.findFirst({
      where: and(eq(dynamicPlugins.siteId, TARGET_SITE), eq(dynamicPlugins.id, 'demo-plugin')),
    })
    expect(row).toBeFalsy()
  })

  it('rejects a plugin whose signature no longer verifies, without touching KV or D1', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const tampered = {
      ...backup,
      plugins: backup.plugins.map(p => ({ ...p, signature: 'tampered' })),
    }
    const result = await applyBackup(mkEvent(REJECT_SITE), REJECT_SITE, tampered, {
      what: ['plugins'],
      conflictMode: 'skip',
    })
    expect(result.plugins.rejected).toBe(1)
    expect(result.plugins.created).toBe(0)

    const db = getCurrentTestDb()
    const row = await db.query.dynamicPlugins.findFirst({
      where: and(eq(dynamicPlugins.siteId, REJECT_SITE), eq(dynamicPlugins.id, 'demo-plugin')),
    })
    expect(row).toBeFalsy()
    expect(kvStore.has(`plugin:${REJECT_SITE}:demo-plugin:server`)).toBe(false)
  })
})

describe('buildBackup() — users and membership tiers', () => {
  it('exports real team members but never super_admin', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const editor = backup.users.find(u => u.email === 'editor@backup-src.test')
    expect(editor).toEqual({ email: 'editor@backup-src.test', name: 'Source Editor', role: 'editor' })
    expect(backup.users.some(u => u.role === 'super_admin')).toBe(false)
    expect(backup.users.find(u => u.email === 'superadmin@backup-src.test')).toBeUndefined()
  })

  it('exports membership tiers (configuration only — no subscriptions)', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const tier = backup.membershipTiers.find(t => t.name === 'Pro')
    expect(tier).toBeTruthy()
    expect(tier!.price).toBe(1999)
    expect(tier!.features).toEqual(['Feature A', 'Feature B'])
    expect(backup).not.toHaveProperty('subscriptions')
  })
})

describe('applyBackup() — restoring users and membership tiers', () => {
  it('provisions a brand-new account for a team member who does not exist on the target, and emails them', async () => {
    // The seeded editor's global account already exists (created directly in
    // beforeAll, to give them a role to export in the first place) — restore onto
    // ANY site would find that real account, correctly *not* treating it as new. To
    // exercise the actual "never existed anywhere" path, inject a synthetic user with
    // an email nothing in this file has ever seeded.
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const withBrandNewUser = {
      ...backup,
      users: [...backup.users, { email: 'brand-new@backup-src.test', name: 'Brand New', role: 'editor' as const }],
    }

    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, withBrandNewUser, {
      what: ['users'],
      conflictMode: 'skip',
    })
    expect(result.users.created).toBe(2) // the seeded editor + the brand-new user — super_admin was never in the backup

    const db = getCurrentTestDb()
    const newUser = await db.query.users.findFirst({ where: eq(users.email, 'brand-new@backup-src.test') })
    expect(newUser).toBeTruthy()

    const role = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.userId, newUser!.id), eq(userSiteRoles.siteId, TARGET_SITE)),
    })
    expect(role?.role).toBe('editor')

    expect(mockRequestPasswordReset).toHaveBeenCalledWith({
      body: { email: 'brand-new@backup-src.test', redirectTo: '/reset-password' },
    })
  })

  it('parseBackupJson() rejects a hand-crafted backup granting super_admin (privilege-escalation guard)', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const tampered = {
      ...backup,
      users: [...backup.users, { email: 'attacker@backup-src.test', name: 'Attacker', role: 'super_admin' }],
    }
    expect(() => parseBackupJson(JSON.stringify(tampered))).toThrow(/validation/i)
  })

  it('applyBackup() skips a super_admin role even when handed directly as an object, bypassing parseBackupJson()', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    // Simulates a caller that never went through the upload-time schema (e.g. a crafted
    // object built by hand) — TS itself no longer allows this literal, hence the cast.
    const tampered = {
      ...backup,
      users: [...backup.users, { email: 'attacker2@backup-src.test', name: 'Attacker Two', role: 'super_admin' as unknown as 'viewer' }],
    }

    const result = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, tampered, {
      what: ['users'],
      conflictMode: 'skip',
    })
    expect(result.users.skipped).toBeGreaterThanOrEqual(1)

    const db = getCurrentTestDb()
    const attacker = await db.query.users.findFirst({ where: eq(users.email, 'attacker2@backup-src.test') })
    expect(attacker).toBeFalsy() // never even provisioned — the role check runs before findOrCreateUserAccount()
  })

  it('assigns a role to an already-existing account without re-creating it or emailing them', async () => {
    const db = getCurrentTestDb()
    const existingId = await seedUser(db, { email: 'already-here@backup-src.test', name: 'Already Here' })

    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const withExisting = {
      ...backup,
      users: [...backup.users, { email: 'already-here@backup-src.test', name: 'Already Here', role: 'viewer' as const }],
    }

    mockRequestPasswordReset.mockClear()
    const result = await applyBackup(mkEvent(REJECT_SITE), REJECT_SITE, withExisting, {
      what: ['users'],
      conflictMode: 'skip',
    })
    expect(result.users.created).toBeGreaterThanOrEqual(1) // the editor, freshly provisioned on this site too

    const role = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.userId, existingId), eq(userSiteRoles.siteId, REJECT_SITE)),
    })
    expect(role?.role).toBe('viewer')
    expect(mockRequestPasswordReset).not.toHaveBeenCalledWith({
      body: { email: 'already-here@backup-src.test', redirectTo: '/reset-password' },
    })
  })

  it('creates a membership tier matched by name, and reapplies changes on overwrite', async () => {
    const backup = await buildBackup(mkEvent(SOURCE_SITE), SOURCE_SITE)
    const created = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['membershipTiers'],
      conflictMode: 'skip',
    })
    expect(created.membershipTiers.created).toBe(1)

    const db = getCurrentTestDb()
    const tier = await db.query.membershipTiers.findFirst({
      where: and(eq(membershipTiers.siteId, TARGET_SITE), eq(membershipTiers.name, 'Pro')),
    })
    expect(tier?.price).toBe(1999)

    // Drift on the target, then overwrite-restore should reapply the backup's price.
    await db.update(membershipTiers).set({ price: 1 }).where(eq(membershipTiers.id, tier!.id))
    const updated = await applyBackup(mkEvent(TARGET_SITE), TARGET_SITE, backup, {
      what: ['membershipTiers'],
      conflictMode: 'overwrite',
    })
    expect(updated.membershipTiers.updated).toBe(1)

    const reapplied = await db.query.membershipTiers.findFirst({ where: eq(membershipTiers.id, tier!.id) })
    expect(reapplied?.price).toBe(1999)
  })
})
