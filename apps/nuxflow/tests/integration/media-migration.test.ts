import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, contentRevisions, media, menus, siteSettings, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// A fake "real" provider standing in for R2: records uploads, and its exists() check can
// be switched off to simulate a copy that didn't actually land.
const stored = new Map<string, { type: string; size: number }>()
let existsWorks = true
let providerName = 'r2'
const fakeProvider = {
  get name() { return providerName },
  servedByWorker: true,
  async upload(file: File, key: string) {
    stored.set(key, { type: file.type, size: file.size })
    return { url: `/_nuxflow/media/${key}`, storageKey: key, provider: 'r2' }
  },
  async delete() {},
  getUrl: (key: string) => `/_nuxflow/media/${key}`,
  async exists(key: string) { return existsWorks && stored.has(key) },
}
vi.mock('../../server/utils/media-providers/index', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getActiveProvider: async () => fakeProvider }
})

const { default: statusHandler } = await import('../../server/api/v1/media/migration.get')
const { default: migrateHandler } = await import('../../server/api/v1/media/migration.post')
const { migrateLocalMediaBatch, WorkBudget } = await import('../../server/utils/media-migration')

const SITE = 'site-migrate-01'
const OTHER_SITE = 'site-migrate-02'
let adminId: string
let typeId: string

/** A distinctive, realistic-length base64 image data: URI. */
function dataUri(seed: number, mime = 'image/png'): string {
  const bytes = new Uint8Array(600).map((_, i) => (i * 31 + seed * 97) % 256)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(binary)}`
}

type Handler = (e: H3Event) => Promise<unknown>
type Batch = { results: { id: string; ok: boolean; error?: string; newUrl?: string }[]; nextCursor: string | null; done: boolean }

function adminEvent(body?: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@migrate.test' } },
    body,
  }) as unknown as H3Event
}

async function runPhase(phase: 'media' | 'inline'): Promise<Batch['results']> {
  const all: Batch['results'] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 500; guard++) {
    const batch = await (migrateHandler as Handler)(adminEvent({ phase, cursor })) as Batch
    all.push(...batch.results)
    cursor = batch.nextCursor
    if (batch.done) return all
  }
  throw new Error('migration never reported done')
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'migrate.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'migrate2.localhost' })
  adminId = await seedUser(db, { email: 'admin@migrate.test', name: 'Admin' })
  await seedRole(db, adminId, SITE, 'admin')
  typeId = await seedContentType(db, SITE)
})
afterAll(teardownTestDb)
beforeEach(() => {
  stored.clear()
  existsWorks = true
  providerName = 'r2'
})

describe('moving database-stored media to real storage', () => {
  it('moves a library file and rewrites every reference to it across the site', async () => {
    const db = getCurrentTestDb()
    const uri = dataUri(1)
    const mediaId = await seedMedia(db, SITE, { url: uri, storageProvider: 'local', mimeType: 'image/png', originalName: 'logo.png', storageKey: 'logo.png' })

    const itemId = await seedContentItem(db, SITE, typeId, {
      slug: 'uses-image',
      content: { type: 'doc', content: [{ type: 'image', attrs: { src: uri } }] },
      ogImage: uri,
      settings: { hero: uri },
      status: 'draft',
      publishedAt: null,
    })
    await db.insert(contentRevisions).values({ id: ulid(), itemId, title: 'old', content: { type: 'doc', content: [{ type: 'image', attrs: { src: uri } }] } })
    const menuId = ulid()
    await db.insert(menus).values({ id: menuId, siteId: SITE, name: 'Main', items: [{ label: 'Logo', icon: uri }] })
    await seedSetting(db, SITE, 'appearance.logo_url', uri)
    await db.update(users).set({ image: uri }).where(eq(users.id, adminId))

    // Another tenant using the identical image must not be touched.
    const foreignItem = await seedContentItem(db, OTHER_SITE, await seedContentType(db, OTHER_SITE), { ogImage: uri })

    const before = await (statusHandler as Handler)(adminEvent()) as { pendingMedia: number; canMigrate: boolean }
    expect(before.canMigrate).toBe(true)
    expect(before.pendingMedia).toBeGreaterThanOrEqual(1)

    const results = await runPhase('media')
    const mine = results.find(r => r.id === mediaId)!
    expect(mine.ok).toBe(true)
    const newUrl = `/_nuxflow/media/${SITE}/${mediaId}.png`
    expect(mine.newUrl).toBe(newUrl)

    const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
    expect(row).toMatchObject({ url: newUrl, storageProvider: 'r2', storageKey: `${SITE}/${mediaId}.png` })
    expect(stored.get(`${SITE}/${mediaId}.png`)?.type).toBe('image/png')

    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(JSON.stringify(item!.content)).toContain(newUrl)
    expect(JSON.stringify(item!.content)).not.toContain('data:image')
    expect(item!.ogImage).toBe(newUrl)
    expect(item!.settings).toEqual({ hero: newUrl })
    expect(item!.version).toBe(2)

    const rev = await db.query.contentRevisions.findFirst({ where: eq(contentRevisions.itemId, itemId) })
    expect(JSON.stringify(rev!.content)).toContain(newUrl)
    const menu = await db.query.menus.findFirst({ where: eq(menus.id, menuId) })
    expect(menu!.items).toEqual([{ label: 'Logo', icon: newUrl }])
    const setting = await db.query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, SITE), eq(siteSettings.key, 'appearance.logo_url')) })
    expect(setting!.value).toBe(newUrl)
    const admin = await db.query.users.findFirst({ where: eq(users.id, adminId) })
    expect(admin!.image).toBe(newUrl)

    const foreign = await db.query.contentItems.findFirst({ where: eq(contentItems.id, foreignItem) })
    expect(foreign!.ogImage).toBe(uri)
  })

  // The database copy is only dropped once the new copy is confirmed to exist.
  it('leaves everything untouched when the uploaded copy cannot be confirmed', async () => {
    const db = getCurrentTestDb()
    const uri = dataUri(2)
    const mediaId = await seedMedia(db, SITE, { url: uri, storageProvider: 'local', mimeType: 'image/png' })
    const itemId = await seedContentItem(db, SITE, typeId, { slug: 'unverified', ogImage: uri })

    existsWorks = false
    const results = await runPhase('media')
    const mine = results.find(r => r.id === mediaId)!
    expect(mine.ok).toBe(false)
    expect(mine.error).toMatch(/could not be read back/)

    const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
    expect(row).toMatchObject({ url: uri, storageProvider: 'local' })
    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(item!.ogImage).toBe(uri)
  })

  it('moves images embedded in content with no library row, creating one for each', async () => {
    const db = getCurrentTestDb()
    // Clear leftovers from the failure test so this phase runs against a known state.
    await db.delete(media).where(eq(media.storageProvider, 'local'))
    const inlineA = dataUri(3)
    const inlineB = dataUri(4, 'image/jpeg')
    const itemId = await seedContentItem(db, SITE, typeId, {
      slug: 'embedded',
      content: { type: 'doc', content: [{ type: 'image', attrs: { src: inlineA } }, { type: 'image', attrs: { src: inlineB } }, { type: 'image', attrs: { src: inlineA } }] },
    })
    const otherId = await seedContentItem(db, SITE, typeId, { slug: 'shares-image', ogImage: inlineA })

    const results = await runPhase('inline')
    expect(results.filter(r => r.ok).length).toBeGreaterThanOrEqual(2)

    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(JSON.stringify(item!.content)).not.toContain('data:image')
    const other = await db.query.contentItems.findFirst({ where: eq(contentItems.id, otherId) })
    // The same image elsewhere reuses the one new copy rather than being duplicated.
    const urls = (JSON.stringify(item!.content).match(/\/_nuxflow\/media\/[^"]+/g) ?? [])
    expect(urls).toContain(other!.ogImage)

    const created = await db.query.media.findMany({ where: and(eq(media.siteId, SITE), eq(media.originalName, 'embedded-image.jpg')) })
    expect(created.length).toBe(1)
    expect(created[0]!.uploadedBy).toBe(adminId)

    const after = await (statusHandler as Handler)(adminEvent()) as { pendingInline: number; pendingMedia: number }
    expect(after.pendingInline).toBe(0)
    expect(after.pendingMedia).toBe(0)
  })

  // Regression: on nuxflow.dev one image was embedded in 62 drafts (107 MB). Loading every
  // referencing row at once blew the Worker's 128 MB limit (bare 503). Rows are now
  // rewritten one at a time within a per-request budget, resuming across requests.
  it('spreads a widely-used file across several bounded requests and finishes it', async () => {
    const db = getCurrentTestDb()
    await db.delete(media).where(eq(media.storageProvider, 'local'))
    const uri = dataUri(5)
    const mediaId = await seedMedia(db, SITE, { url: uri, storageProvider: 'local', mimeType: 'image/png' })
    const drafts: string[] = []
    for (let i = 0; i < 12; i++) {
      drafts.push(await seedContentItem(db, SITE, typeId, {
        slug: `wide-${i}`,
        status: 'draft',
        publishedAt: null,
        content: { type: 'doc', content: [{ type: 'image', attrs: { src: uri } }] },
      }))
    }

    let calls = 0
    let cursor: string | null = null
    let sawPartial = false
    for (;;) {
      calls++
      // Tiny budget: only a few rows can be rewritten per request.
      const batch = await migrateLocalMediaBatch(adminEvent(), { cursor, budget: new WorkBudget(10) })
      const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
      if (!batch.done && row!.storageProvider === 'local') {
        sawPartial = true
        // Mid-way: the database copy must still exist, since unrewritten drafts use it.
        expect(row!.url).toBe(uri)
      }
      cursor = batch.nextCursor
      if (batch.done) break
      if (calls > 50) throw new Error('never finished')
    }

    expect(calls).toBeGreaterThan(2)
    expect(sawPartial).toBe(true)
    const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
    expect(row!.storageProvider).toBe('r2')
    for (const id of drafts) {
      const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) })
      expect(JSON.stringify(item!.content)).not.toContain('data:image')
    }
  })

  it('refuses to run while no real storage is connected', async () => {
    providerName = 'local'
    await expect((migrateHandler as Handler)(adminEvent({ phase: 'media' }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('requires an admin', async () => {
    const db = getCurrentTestDb()
    const editorId = await seedUser(db, { email: 'editor@migrate.test' })
    await seedRole(db, editorId, SITE, 'editor')
    const event = createMockEvent({ siteId: SITE, session: { user: { id: editorId, name: 'E', email: 'editor@migrate.test' } }, body: { phase: 'media' } })
    await expect((migrateHandler as Handler)(event as unknown as H3Event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
