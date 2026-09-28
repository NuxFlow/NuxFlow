/**
 * Backup/restore coverage for SEO data:
 *   - seo.* site settings round-trip (and are validated on restore — a backup or theme
 *     demo.json is hand-editable)
 *   - per-page SEO/event fields (robots, canonical, focus keyword, event details)
 *   - redirects (previously not in backups at all)
 *   - IndexNow switched on by a restore gets a fresh per-site key
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedContentType, seedContentItem, seedSetting } from '../helpers/seed'
import { contentItems, redirects, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/cf-theme-kv', () => ({
  getThemeCSS: async () => null,
  putThemeCSS: async () => {},
  getThemeDemo: async () => null,
  putThemeDemo: async () => {},
}))
vi.mock('../../server/utils/cf-plugin-kv', () => ({
  getPluginServerCode: async () => null,
  putPluginServerCode: async () => {},
  getPluginClientBundle: async () => null,
  putPluginClientBundle: async () => {},
}))
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({ api: {} }),
  clearBetterAuthCache: () => {},
}))

const { buildBackup, applyBackup } = await import('../../server/utils/backup')
const { clearSeoSettingsCache } = await import('../../server/utils/seo')
const { clearRedirectCache } = await import('../../server/utils/redirect-cache')

const SOURCE = 'site-bk-seo-src'
const TARGET = 'site-bk-seo-dst'
const THEME_TARGET = 'site-bk-seo-theme'
const ev = (siteId: string) => createMockEvent({ siteId }) as unknown as H3Event

async function settingsOf(siteId: string) {
  const rows = await getCurrentTestDb().query.siteSettings.findMany({ where: eq(siteSettings.siteId, siteId) })
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SOURCE, domain: 'bk-src.localhost' })
  await seedSite(db, { id: TARGET, domain: 'bk-dst.localhost' })
  await seedSite(db, { id: THEME_TARGET, domain: 'bk-theme.localhost' })
  for (const s of [SOURCE, TARGET, THEME_TARGET]) await seedContentType(db, s, { slug: 'event', name: 'Events', singularName: 'Event' })
  const eventType = (await db.query.contentTypes.findFirst({ where: (t, { eq: e }) => e(t.siteId, SOURCE) }))!.id

  await seedContentItem(db, SOURCE, eventType, {
    slug: 'launch-party',
    title: 'Launch party',
    metaRobots: 'noindex,follow',
    canonicalUrl: 'https://elsewhere.test/launch',
    focusKeyword: 'launch',
    allowComments: true,
    eventStartAt: '2026-11-01T18:00:00.000Z',
    eventEndAt: '2026-11-01T21:00:00.000Z',
    eventLocation: 'Town Hall',
    eventUrl: 'https://tickets.test',
  })
  await seedSetting(db, SOURCE, 'seo.description', 'Source description')
  await seedSetting(db, SOURCE, 'seo.ai_crawlers', 'block-training')
  await seedSetting(db, SOURCE, 'seo.social_profiles', ['https://github.com/acme'] as unknown as string)
  await db.insert(redirects).values([
    { id: ulid(), siteId: SOURCE, from: '/old', to: '/launch-party', statusCode: 301 },
    { id: ulid(), siteId: SOURCE, from: '/gone', to: '', statusCode: 410 },
  ])
})

afterAll(teardownTestDb)

describe('buildBackup', () => {
  it('includes seo settings, per-page SEO/event fields, and redirects', async () => {
    const backup = await buildBackup(ev(SOURCE), SOURCE)
    expect(backup.settings['seo.description']).toBe('Source description')
    expect(backup.settings['seo.social_profiles']).toEqual(['https://github.com/acme'])
    const item = backup.content.find(c => c.slug === 'launch-party')!
    expect(item).toMatchObject({
      metaRobots: 'noindex,follow',
      canonicalUrl: 'https://elsewhere.test/launch',
      focusKeyword: 'launch',
      allowComments: true,
      eventStartAt: '2026-11-01T18:00:00.000Z',
      eventLocation: 'Town Hall',
      eventUrl: 'https://tickets.test',
    })
    expect(backup.redirects).toEqual(expect.arrayContaining([
      { from: '/old', to: '/launch-party', statusCode: 301 },
      { from: '/gone', to: '', statusCode: 410 },
    ]))
  })
})

describe('applyBackup', () => {
  it('restores all of it onto another site', async () => {
    const backup = await buildBackup(ev(SOURCE), SOURCE)
    const result = await applyBackup(ev(TARGET), TARGET, backup, { what: ['content', 'settings', 'redirects'], conflictMode: 'skip' })
    expect(result.redirects).toEqual({ created: 2, updated: 0, skipped: 0 })

    const kv = await settingsOf(TARGET)
    expect(kv['seo.description']).toBe('Source description')
    expect(kv['seo.ai_crawlers']).toBe('block-training')

    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, TARGET), eq(contentItems.slug, 'launch-party')),
    })
    expect(item).toMatchObject({ metaRobots: 'noindex,follow', canonicalUrl: 'https://elsewhere.test/launch', eventLocation: 'Town Hall', allowComments: true })

    const rules = await getCurrentTestDb().query.redirects.findMany({ where: eq(redirects.siteId, TARGET) })
    expect(rules.map(r => r.from).sort()).toEqual(['/gone', '/old'])
  })

  it('restores older backups (no redirects/SEO fields) without errors or blanking values', async () => {
    const backup = await buildBackup(ev(SOURCE), SOURCE)
    delete backup.redirects
    for (const c of backup.content) {
      delete c.metaRobots
      delete c.canonicalUrl
      c.title = 'Launch party (v2)'
    }
    await applyBackup(ev(TARGET), TARGET, backup, { what: ['content', 'redirects'], conflictMode: 'overwrite' })
    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, TARGET), eq(contentItems.slug, 'launch-party')),
    })
    expect(item?.title).toBe('Launch party (v2)')
    expect(item?.metaRobots).toBe('noindex,follow') // untouched, not nulled
  })

  it('validates seo.* values from a hand-edited backup and generates an IndexNow key when needed (theme demo import)', async () => {
    const backup = await buildBackup(ev(SOURCE), SOURCE)
    backup.settings = {
      'seo.canonical_url': 'https://theme.test/',       // normalized (trailing slash)
      'seo.ai_crawlers': 'sometimes',                    // invalid → skipped
      'seo.nonsense': 'x',                               // unknown → skipped
      'seo.indexnow_enabled': true,                      // no key shipped → generated
      'seo.redirect_to_primary': false,
      'theme.primary_color': '#00dc82',                  // non-SEO → as-is
    }
    backup.content = []
    backup.redirects = [{ from: '/loop', to: '/loop', statusCode: 301 }, { from: '/ok', to: '/', statusCode: 301 }]
    // Same `what` + conflict mode the Themes page's "Import demo content" sends.
    const result = await applyBackup(ev(THEME_TARGET), THEME_TARGET, backup, { what: ['content', 'taxonomies', 'menus', 'forms', 'settings', 'redirects'], conflictMode: 'archive' })

    const kv = await settingsOf(THEME_TARGET)
    expect(kv['seo.canonical_url']).toBe('https://theme.test')
    expect(kv['seo.ai_crawlers']).toBeUndefined()
    expect(kv['seo.nonsense']).toBeUndefined()
    expect(kv['theme.primary_color']).toBe('#00dc82')
    expect(kv['seo.indexnow_key']).toMatch(/^[0-9a-f]{32}$/)
    expect(result.redirects).toEqual({ created: 1, updated: 0, skipped: 1 })
  })

  it('keeps existing settings and redirects in skip/archive mode, replaces them in overwrite mode', async () => {
    const db = getCurrentTestDb()
    await db.delete(siteSettings).where(and(eq(siteSettings.siteId, TARGET), eq(siteSettings.key, 'seo.description')))
    await seedSetting(db, TARGET, 'seo.description', 'Kept')
    clearSeoSettingsCache(TARGET)
    const backup = await buildBackup(ev(SOURCE), SOURCE)
    backup.redirects = [{ from: '/old', to: '/somewhere-else', statusCode: 302 }]

    await applyBackup(ev(TARGET), TARGET, backup, { what: ['settings', 'redirects'], conflictMode: 'archive' })
    expect((await settingsOf(TARGET))['seo.description']).toBe('Kept')
    let rule = await db.query.redirects.findFirst({ where: and(eq(redirects.siteId, TARGET), eq(redirects.from, '/old')) })
    expect(rule?.to).toBe('/launch-party')

    await applyBackup(ev(TARGET), TARGET, backup, { what: ['settings', 'redirects'], conflictMode: 'overwrite' })
    clearRedirectCache(TARGET)
    expect((await settingsOf(TARGET))['seo.description']).toBe('Source description')
    rule = await db.query.redirects.findFirst({ where: and(eq(redirects.siteId, TARGET), eq(redirects.from, '/old')) })
    expect(rule).toMatchObject({ to: '/somewhere-else', statusCode: 302 })
  })
})
