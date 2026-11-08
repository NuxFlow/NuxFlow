import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { createHash, webcrypto } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { contentItems, media, menus, siteSettings, starterInstalls, themes } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'
import { catalogSigningInput } from '../../shared/lib/starters'
import { buildStarter, catalogPayload } from '../../scripts/starters/lib'
import type * as CfEnv from '../../server/utils/cf-env'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { kv, provider, putThemeCSSMock } = vi.hoisted(() => ({
  kv: { get: vi.fn(async () => null), put: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  provider: {
    name: 'r2',
    upload: vi.fn(async (_file: File, key: string) => ({ url: `/_nuxflow/media/${key}`, storageKey: key, provider: 'r2' })),
    delete: vi.fn(async () => {}),
    getUrl: vi.fn(),
  },
  putThemeCSSMock: vi.fn(async () => {}),
}))
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  getCfBindings: () => ({ kv, loader: null, r2: null }),
  getAnalyticsEngine: () => null,
  waitUntil: (_event: unknown, promise: Promise<unknown>) => { void promise.catch(() => {}) },
}))
vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(async () => provider),
}))
vi.mock('../../server/utils/cf-theme-kv', () => ({
  putThemeCSS: (...args: unknown[]) => putThemeCSSMock(...(args as [])),
}))

const { default: postHandler } = await import('../../server/api/v1/starters/index.post')
const { default: getHandler } = await import('../../server/api/v1/starters/index.get')
const { seedNewSite } = await import('../../server/utils/site-seeding')
const { clearStarterCatalogCache } = await import('../../server/utils/starters/catalog')

type Handler = (e: H3Event) => Promise<unknown>
interface Answer {
  install: { id: string; status: string; phase: string; imagesDone: number; imagesTotal: number; mode: string } | null
  result: { draftedItems: number; settingsKept: string[]; content: { created: number; updated: number } } | null
}

const CATALOG_URL = 'https://starters.test/catalog.json'
const SITE = 'site-starters-a'
const FRESH = 'site-starters-b'
let adminId: string
const enc = (s: string) => new TextEncoder().encode(s)
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

// ── A signed test catalog served by a stubbed fetch ───────────────────────────
const files = new Map<string, Uint8Array>()
let catalogText = ''

async function publishCatalog() {
  const demo = {
    version: '1', exportedAt: '2026-11-01T00:00:00Z',
    site: { name: 'x', locale: 'en', timezone: 'UTC' },
    settings: {
      'theme.primary_color': '#123456',
      'appearance.custom_head_html': '<link rel="stylesheet" href="https://fonts.example/x.css">',
      'appearance.logo_url': 'images/logo.png',
      'seo.canonical_url': 'https://someone-else.example',
    },
    contentTypes: [],
    content: [
      {
        typeSlug: 'page', slug: 'home', title: '{{site_name}} Café', status: 'published', visibility: 'public',
        content: { type: 'canvas', blocks: [{ id: 'h', type: 'canvas-hero', props: { headline: 'Hi', bgImage: 'images/hero.png' } }] },
        excerpt: null, seoTitle: null, seoDescription: null, ogImage: 'images/hero.png', publishedAt: '2026-11-01T00:00:00Z',
        settings: null, termSlugs: [], locale: null, sourceItemSlug: null,
      },
      {
        typeSlug: 'page', slug: 'menu', title: 'Our menu', status: 'published', visibility: 'public',
        content: { type: 'doc', content: [] },
        excerpt: null, seoTitle: null, seoDescription: null, ogImage: null, publishedAt: '2026-11-01T00:00:00Z',
        settings: null, termSlugs: [], locale: null, sourceItemSlug: null,
      },
    ],
    taxonomies: [],
    menus: [{ name: 'Main menu', location: 'header', items: [{ label: 'Menu', url: '/menu' }] }],
    forms: [], media: [], themes: [], plugins: [], users: [], membershipTiers: [],
  }
  const built = buildStarter(
    { id: 'cafe', name: 'Corner Café', description: 'A café', category: 'Food', version: '1.0.0' },
    [
      { path: 'demo.json', bytes: enc(JSON.stringify(demo)) },
      { path: 'theme.css', bytes: enc(':root { --nuxflow-primary: #123456; }') },
      { path: 'images/hero.png', bytes: enc('fake-png-hero') },
      { path: 'images/logo.png', bytes: enc('fake-png-logo') },
    ],
    sha256,
  )
  for (const f of built.files) files.set(new URL(f.key, CATALOG_URL).toString(), f.bytes)
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64url')
  const payload = JSON.stringify(catalogPayload([built.entry]))
  const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, catalogSigningInput(payload))).toString('base64url')
  catalogText = JSON.stringify({ format: 'nuxflow-starter-catalog', version: 1, payload, signature })

  const original = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = (() => ({ ...original(), startersCatalogUrl: CATALOG_URL, startersPublicKey: publicKey })) as typeof globalThis.useRuntimeConfig
}

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = input.toString()
  if (url === CATALOG_URL) return new Response(catalogText, { status: 200 })
  const body = files.get(url)
  return body ? new Response(body, { status: 200 }) : new Response('nope', { status: 404 })
}))

function adminEvent(siteId: string, body?: unknown, query?: Record<string, string>) {
  return createMockEvent({
    siteId,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@starters.test' } },
    body,
    query,
  }) as unknown as H3Event
}

async function itemsBySlug(siteId: string) {
  const rows = await getCurrentTestDb().query.contentItems.findMany({ where: eq(contentItems.siteId, siteId) })
  return new Map(rows.map(r => [r.slug, r]))
}

async function setting(siteId: string, key: string) {
  const row = await getCurrentTestDb().query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)) })
  return row?.value
}

beforeAll(async () => {
  await initTestDb()
  await publishCatalog()
  const db = getCurrentTestDb()
  adminId = await seedUser(db, { email: 'admin@starters.test', name: 'Admin' })
  await seedSite(db, { id: SITE, domain: 'starters-a.localhost', name: 'Acme' })
  await seedSite(db, { id: FRESH, domain: 'starters-b.localhost', name: 'Bean There' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, adminId, FRESH, 'admin')
})
afterAll(teardownTestDb)
beforeEach(() => {
  clearStarterCatalogCache()
  provider.name = 'r2'
})

describe('seeding a new site', () => {
  it('uses a built-in starter directly', async () => {
    await seedNewSite(getCurrentTestDb(), { siteId: SITE, siteName: 'Acme', authorId: adminId, template: 'landing' })
    const items = await itemsBySlug(SITE)
    expect(items.get('home')!.status).toBe('published')
    expect(JSON.stringify(items.get('home')!.content)).toContain('canvas-hero')
    expect(items.get('home')!.authorId).toBe(adminId)
    expect(items.get('privacy')!.status).toBe('published')
    expect(await getCurrentTestDb().query.starterInstalls.findFirst({ where: eq(starterInstalls.siteId, SITE) })).toBeUndefined()
  })

  it('starts blank with a pending install for a catalog starter', async () => {
    await seedNewSite(getCurrentTestDb(), { siteId: FRESH, siteName: 'Bean There', authorId: adminId, template: 'cafe' })
    const items = await itemsBySlug(FRESH)
    expect(JSON.stringify(items.get('home')!.content)).toContain('blank canvas')
    const res = await (getHandler as Handler)(adminEvent(FRESH, undefined, { installOnly: '1' })) as { install: { mode: string; status: string; starterId: string } }
    expect(res.install).toMatchObject({ mode: 'fresh', status: 'pending', starterId: 'cafe' })
  })
})

describe('Admin → Starter sites', () => {
  it('lists the catalog starters before the built-in ones', async () => {
    const res = await (getHandler as Handler)(adminEvent(SITE)) as { starters: { id: string }[]; catalogError: string | null; storageReady: boolean }
    expect(res.catalogError).toBeNull()
    expect(res.storageReady).toBe(true)
    expect(res.starters.map(s => s.id)).toEqual(['cafe', 'landing', 'blog', 'portfolio', 'blank'])
  })

  it('switching to a built-in starter keeps old pages as drafts, the privacy page live', async () => {
    const db = getCurrentTestDb()
    const page = (await itemsBySlug(SITE)).get('home')!.typeId
    await db.insert(contentItems).values({ id: 'about-a', siteId: SITE, typeId: page, slug: 'about', title: 'About', status: 'published', visibility: 'public', content: {} })

    const res = await (postHandler as Handler)(adminEvent(SITE, { action: 'install', starterId: 'blog' })) as Answer
    expect(res.install).toBeNull()
    expect(res.result!.draftedItems).toBe(2) // home + about; privacy kept

    const items = await itemsBySlug(SITE)
    expect(items.get('about')!.status).toBe('draft')
    expect(items.get('privacy')!.status).toBe('published')
    expect(items.get('hello-world')!.status).toBe('published')
    expect(JSON.stringify(items.get('home')!.content)).toContain('Welcome to Our Journal')
    const backups = [...items.keys()].filter(s => s.startsWith('home-backup-'))
    expect(backups).toHaveLength(1)
    expect(items.get(backups[0]!)!.status).toBe('draft')
    expect(await setting(SITE, 'starters.applied')).toMatchObject({ id: 'blog' })
  })

  it('refuses a catalog starter with images while storage is the database fallback', async () => {
    provider.name = 'local'
    const start = await (postHandler as Handler)(adminEvent(SITE, { action: 'install', starterId: 'cafe' })) as Answer
    await expect((postHandler as Handler)(adminEvent(SITE, { action: 'step', installId: start.install!.id })))
      .rejects.toMatchObject({ statusCode: 409 })
    const after = await (getHandler as Handler)(adminEvent(SITE, undefined, { installOnly: '1' })) as { install: { status: string; error: string } }
    expect(after.install.status).toBe('pending')
    expect(after.install.error).toMatch(/file storage/)

    // Only one unfinished install at a time.
    await expect((postHandler as Handler)(adminEvent(SITE, { action: 'install', starterId: 'cafe' }))).rejects.toMatchObject({ statusCode: 409 })

    const cancelled = await (postHandler as Handler)(adminEvent(SITE, { action: 'cancel', installId: start.install!.id })) as Answer
    expect(cancelled.install!.status).toBe('cancelled')
  })

  it('installs a catalog starter step by step: images to storage, then pages, theme and settings', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'appearance.logo_url', '/my-logo.png')
    let answer = await (postHandler as Handler)(adminEvent(SITE, { action: 'install', starterId: 'cafe' })) as Answer
    const phases: string[] = []
    for (let i = 0; i < 10 && answer.install!.status !== 'done'; i++) {
      answer = await (postHandler as Handler)(adminEvent(SITE, { action: 'step', installId: answer.install!.id })) as Answer
      phases.push(answer.install!.phase)
    }
    expect(answer.install!.status).toBe('done')
    expect(phases).toEqual(['images', 'apply', 'done'])
    expect(answer.result!.settingsKept).toEqual(['appearance.logo_url'])

    const uploaded = await db.query.media.findMany({ where: eq(media.siteId, SITE) })
    expect(uploaded.map(m => m.originalName).sort()).toEqual(['hero.png', 'logo.png'])
    const heroUrl = uploaded.find(m => m.originalName === 'hero.png')!.url
    expect(heroUrl.startsWith(`/_nuxflow/media/${SITE}/starters/`)).toBe(true)

    const items = await itemsBySlug(SITE)
    const home = items.get('home')!
    expect(home.title).toBe('Acme Café')
    expect(home.ogImage).toBe(heroUrl)
    expect(JSON.stringify(home.content)).toContain(heroUrl)
    expect(JSON.stringify(home.content)).not.toContain('images/hero.png')
    expect(items.get('hello-world')!.status).toBe('draft') // the previous starter's post
    expect(items.get('menu')!.authorId).toBe(adminId)

    const header = await db.query.menus.findMany({ where: and(eq(menus.siteId, SITE), eq(menus.location, 'header')) })
    expect(header.map(m => m.name)).toEqual(['Main menu'])

    const theme = await db.query.themes.findFirst({ where: and(eq(themes.siteId, SITE), eq(themes.isActive, true)) })
    expect(theme).toMatchObject({ packageName: '@starter/cafe', name: 'Corner Café' })
    expect(putThemeCSSMock).toHaveBeenCalled()

    expect(await setting(SITE, 'theme.primary_color')).toBe('#123456')
    expect(await setting(SITE, 'appearance.custom_head_html')).toContain('fonts.example')
    expect(await setting(SITE, 'appearance.logo_url')).toBe('/my-logo.png')
    // Never copied from a starter: it would point this site's canonical at someone else's.
    expect(await setting(SITE, 'seo.canonical_url')).toBeUndefined()
  })

  it('switching back to a built-in starter undoes the catalog starter\'s look but not the owner\'s changes', async () => {
    const db = getCurrentTestDb()
    await db.update(siteSettings).set({ value: '<script>owner analytics</script>' })
      .where(and(eq(siteSettings.siteId, SITE), eq(siteSettings.key, 'appearance.custom_head_html')))

    await (postHandler as Handler)(adminEvent(SITE, { action: 'install', starterId: 'landing' }))
    expect(await setting(SITE, 'theme.primary_color')).toBeUndefined()
    expect(await setting(SITE, 'appearance.custom_head_html')).toBe('<script>owner analytics</script>')
    const active = await db.query.themes.findFirst({ where: and(eq(themes.siteId, SITE), eq(themes.isActive, true)) })
    expect(active).toBeUndefined()
  })

  it('finishes a new site\'s pending install by replacing its placeholder pages', async () => {
    const pending = await (getHandler as Handler)(adminEvent(FRESH, undefined, { installOnly: '1' })) as { install: { id: string } }
    let answer: Answer = { install: { id: pending.install.id, status: 'pending' } as Answer['install'], result: null }
    for (let i = 0; i < 10 && answer.install!.status !== 'done'; i++) {
      answer = await (postHandler as Handler)(adminEvent(FRESH, { action: 'step', installId: pending.install.id })) as Answer
    }
    expect(answer.install!.status).toBe('done')
    expect(answer.result!.draftedItems).toBe(0)
    const items = await itemsBySlug(FRESH)
    expect(items.get('home')!.title).toBe('Bean There Café')
    expect([...items.keys()].some(s => s.startsWith('home-backup-'))).toBe(false)
  })

  it('cancelling part-way removes the images it had copied', async () => {
    const db = getCurrentTestDb()
    const start = await (postHandler as Handler)(adminEvent(FRESH, { action: 'install', starterId: 'cafe' })) as Answer
    await (postHandler as Handler)(adminEvent(FRESH, { action: 'step', installId: start.install!.id })) // resolve
    await (postHandler as Handler)(adminEvent(FRESH, { action: 'step', installId: start.install!.id })) // images
    const prefix = `${FRESH}/starters/${start.install!.id}/`
    const copied = (await db.query.media.findMany({ where: eq(media.siteId, FRESH) })).filter(m => m.storageKey.startsWith(prefix))
    expect(copied).toHaveLength(2)

    await (postHandler as Handler)(adminEvent(FRESH, { action: 'cancel', installId: start.install!.id }))
    const left = (await db.query.media.findMany({ where: eq(media.siteId, FRESH) })).filter(m => m.storageKey.startsWith(prefix))
    expect(left).toHaveLength(0)
    expect(provider.delete).toHaveBeenCalled()
  })
})
