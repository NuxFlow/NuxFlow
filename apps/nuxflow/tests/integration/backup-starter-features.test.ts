/**
 * Backup → restore round trip for what the starter-site features added (Nov 2026): shop
 * products with variants and download files, the shop switch, class passes, holiday-let
 * calendars, an event's intake form and a tier-gated page (both linked by id, which a
 * restore changes), photos' camera details and focal points, and the JSON settings with
 * their own checks (business, podcast, appointments, shop).
 *
 * Goes through the real GET /api/v1/backup and POST /api/v1/restore handlers, so the zip
 * bundling of downloads is covered too.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { unzipSync, zipSync } from 'fflate'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { ulid } from 'ulid'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedTier, seedSetting } from '../helpers/seed'
import {
  availabilityBlocks, availabilityFeeds, classPasses, contentItems, forms, media, membershipTiers,
  products, productVariants, siteSettings,
} from '@nuxflow/db/schema'
import backupGetHandler from '../../server/api/v1/backup.get'
import restorePostHandler from '../../server/api/v1/restore.post'
import type { NuxFlowBackup, RestoreResult } from '../../server/utils/backup'

vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeAllPublicPages: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('h3', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendStream: (_event: unknown, stream: ReadableStream) => stream,
}))

type HandlerFn = (e: H3Event) => Promise<unknown>

const SRC = 'site-bk-features-src'
const DST = 'site-bk-features-dst'
const SAME = SRC
const FILE_KEY = `_private/${SRC}/shop/VARIANTFILE/01-guide.pdf`

let adminId: string
let eventItemId: string
let productItemId: string
let digitalVariantId: string
let goldTierId: string

// One bucket for the whole file (cf-env remembers the binding it last saw).
const objects = new Map<string, Uint8Array>()
const bucket = {
  get: vi.fn(async (key: string) => objects.has(key) ? { body: new Response(objects.get(key)!).body } : null),
  put: vi.fn(async (key: string, data: ArrayBuffer | Uint8Array | Blob) => {
    objects.set(key, new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data))
  }),
  head: vi.fn(async (key: string) => objects.has(key) ? {} : null),
  delete: vi.fn(async (keys: string | string[]) => { for (const k of [keys].flat()) objects.delete(k) }),
}

function adminEvent(siteId: string, extra: Parameters<typeof createMockEvent>[0] = {}) {
  const event = createMockEvent({
    siteId,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@bk-features.test' } },
    ...extra,
  }) as unknown as H3Event & { context: Record<string, unknown> }
  event.context.cloudflare = { env: { MEDIA_BUCKET: bucket } }
  return event
}

async function takeBackup(siteId: string): Promise<{ backup: NuxFlowBackup; files: Record<string, Uint8Array> }> {
  const stream = await (backupGetHandler as HandlerFn)(adminEvent(siteId))
  const files = unzipSync(new Uint8Array(await new Response(stream as ReadableStream).arrayBuffer()))
  return { backup: JSON.parse(new TextDecoder().decode(files['backup.json'])) as NuxFlowBackup, files }
}

async function restore(siteId: string, zip: Uint8Array, query: Record<string, string>) {
  const event = adminEvent(siteId, {
    method: 'POST',
    query,
    multipartFormData: [{ name: 'file', filename: 'backup.zip', type: 'application/zip', data: zip }],
  })
  return await (restorePostHandler as HandlerFn)(event) as { result: RestoreResult }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SRC, domain: 'bk-features-src.localhost' })
  await seedSite(db, { id: DST, domain: 'bk-features-dst.localhost' })
  adminId = await seedUser(db, { email: 'admin@bk-features.test' })
  await seedRole(db, adminId, SRC, 'admin')
  await seedRole(db, adminId, DST, 'admin')

  const formId = ulid()
  await db.insert(forms).values({ id: formId, siteId: SRC, slug: 'waiver', name: 'Waiver', fields: [{ key: 'ok', type: 'checkbox', label: 'I agree' }], status: 'active' })
  goldTierId = await seedTier(db, SRC, { name: 'Gold' })

  const eventType = await seedContentType(db, SRC, { slug: 'event', name: 'Events', singularName: 'Event' })
  eventItemId = await seedContentItem(db, SRC, eventType, { slug: 'yoga', title: 'Yoga', status: 'published' })
  await db.update(contentItems).set({ settings: { intakeFormId: formId, access: `tier:${goldTierId}` } }).where(eq(contentItems.id, eventItemId))

  const productType = await seedContentType(db, SRC, { slug: 'product', name: 'Products', singularName: 'Product' })
  productItemId = await seedContentItem(db, SRC, productType, { slug: 'guide', title: 'The guide', status: 'published' })
  await db.insert(products).values({ contentItemId: productItemId, siteId: SRC, optionNames: ['Format'], images: [{ url: 'https://img.example/a.jpg' }] })
  digitalVariantId = ulid()
  await db.insert(productVariants).values([
    { id: ulid(), siteId: SRC, contentItemId: productItemId, sku: 'GUIDE-PRINT', options: ['Print'], priceMinor: 2500, stock: 7, kind: 'physical', sortOrder: 0 },
    { id: digitalVariantId, siteId: SRC, contentItemId: productItemId, sku: 'GUIDE-PDF', options: ['PDF'], priceMinor: 900, kind: 'digital', sortOrder: 1, fileKey: FILE_KEY, fileName: 'guide.pdf', fileSize: 5 },
  ])
  objects.set(FILE_KEY, new TextEncoder().encode('%PDF!'))

  const letType = await seedContentType(db, SRC, { slug: 'page', name: 'Pages', singularName: 'Page' })
  const letId = await seedContentItem(db, SRC, letType, { slug: 'cottage', title: 'Cottage', status: 'published' })
  const feedId = ulid()
  await db.insert(availabilityFeeds).values({ id: feedId, siteId: SRC, contentItemId: letId, url: 'https://www.airbnb.com/calendar/ical/1.ics', label: 'Airbnb', lastSyncedAt: new Date().toISOString() })
  await db.insert(availabilityBlocks).values([
    { id: ulid(), siteId: SRC, contentItemId: letId, feedId, startDate: '2027-01-01', endDate: '2027-01-03', note: '' },
    { id: ulid(), siteId: SRC, contentItemId: letId, feedId: null, startDate: '2027-02-01', endDate: '2027-02-05', note: 'Owner stay' },
  ])

  await db.insert(classPasses).values({ id: ulid(), siteId: SRC, name: '10 classes', credits: 10, price: 80, currency: 'GBP', validDays: 90 })

  await seedMedia(db, SRC, { originalName: 'photo.jpg', size: 4, url: 'data:image/jpeg;base64,AAAA', storageProvider: 'local' })
  await db.update(media).set({ metadata: { exif: { make: 'Fujifilm', model: 'X-T5' } }, focalX: 30, focalY: 70 }).where(eq(media.siteId, SRC))

  await seedSetting(db, SRC, 'shop.enabled', true)
  await seedSetting(db, SRC, 'shop.config', { currency: 'GBP', collectionEnabled: true })
  await seedSetting(db, SRC, 'business.profile', { name: 'Cafe', kind: 'CafeOrCoffeeShop' })
})

afterAll(teardownTestDb)

const ALL = 'content,taxonomies,menus,forms,settings,membershipTiers,redirects'

describe('backup of the starter-site features', () => {
  it('exports products, calendars, passes, the shop switch, links by name and photo details', async () => {
    const { backup, files } = await takeBackup(SRC)

    const yoga = backup.content.find(c => c.slug === 'yoga')!
    expect(yoga.intakeFormSlug).toBe('waiver')
    expect(yoga.accessTierName).toBe('Gold')

    const guide = backup.content.find(c => c.slug === 'guide')!
    expect(guide.product?.optionNames).toEqual(['Format'])
    expect(guide.product?.variants.map(v => v.sku)).toEqual(['GUIDE-PRINT', 'GUIDE-PDF'])
    const pdf = guide.product!.variants[1]!
    expect(pdf.fileZipPath).toBe(`downloads/${digitalVariantId}/guide.pdf`)
    expect(new TextDecoder().decode(files[pdf.fileZipPath!])).toBe('%PDF!')
    expect(JSON.stringify(backup)).not.toContain(FILE_KEY)

    const cottage = backup.content.find(c => c.slug === 'cottage')!
    expect(cottage.availability?.feeds).toEqual([{ url: 'https://www.airbnb.com/calendar/ical/1.ics', label: 'Airbnb' }])
    // Own blocks only: the feed's nights come back with its next sync.
    expect(cottage.availability?.blocks).toEqual([{ start: '2027-02-01', end: '2027-02-05', note: 'Owner stay' }])

    expect(backup.classPasses).toEqual([expect.objectContaining({ name: '10 classes', credits: 10, price: 80, validDays: 90 })])
    expect(backup.shop).toEqual({ enabled: true })
    expect(backup.settings['shop.enabled']).toBeUndefined()
    expect(backup.media[0]).toMatchObject({ metadata: { exif: { make: 'Fujifilm' } }, focalX: 30, focalY: 70 })
  })

  it('restores all of it onto another site, with links pointing at that site\'s own rows', async () => {
    const { files } = await takeBackup(SRC)
    const res = await restore(DST, zipSync(files), { what: ALL, conflictMode: 'skip' })
    const db = getCurrentTestDb()

    const form = await db.query.forms.findFirst({ where: and(eq(forms.siteId, DST), eq(forms.slug, 'waiver')) })
    const tier = await db.query.membershipTiers.findFirst({ where: and(eq(membershipTiers.siteId, DST), eq(membershipTiers.name, 'Gold')) })
    const yoga = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, DST), eq(contentItems.slug, 'yoga')) })
    expect(yoga?.settings).toMatchObject({ intakeFormId: form!.id, access: `tier:${tier!.id}` })
    expect(tier!.id).not.toBe(goldTierId)

    const guide = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, DST), eq(contentItems.slug, 'guide')) })
    const product = await db.query.products.findFirst({ where: eq(products.contentItemId, guide!.id) })
    expect(product?.optionNames).toEqual(['Format'])
    const variants = await db.query.productVariants.findMany({ where: eq(productVariants.contentItemId, guide!.id) })
    expect(variants.map(v => v.sku).sort()).toEqual(['GUIDE-PDF', 'GUIDE-PRINT'])
    expect(variants.find(v => v.sku === 'GUIDE-PRINT')?.stock).toBe(7)
    const pdf = variants.find(v => v.sku === 'GUIDE-PDF')!
    expect(pdf.id).not.toBe(digitalVariantId)
    expect(pdf.fileKey).toMatch(new RegExp(`^_private/${DST}/shop/${pdf.id}/`))
    expect(new TextDecoder().decode(objects.get(pdf.fileKey!))).toBe('%PDF!')
    expect(res.result.products).toEqual({ restored: 1, files: 1 })

    const cottage = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, DST), eq(contentItems.slug, 'cottage')) })
    const feeds = await db.query.availabilityFeeds.findMany({ where: eq(availabilityFeeds.contentItemId, cottage!.id) })
    expect(feeds.map(f => [f.url, f.lastSyncedAt])).toEqual([['https://www.airbnb.com/calendar/ical/1.ics', null]])
    const blocks = await db.query.availabilityBlocks.findMany({ where: eq(availabilityBlocks.contentItemId, cottage!.id) })
    expect(blocks.map(b => [b.startDate, b.endDate, b.note, b.feedId])).toEqual([['2027-02-01', '2027-02-05', 'Owner stay', null]])
    expect(res.result.warnings?.some(w => w.includes('calendar export link'))).toBe(true)

    expect(await db.query.classPasses.findMany({ where: eq(classPasses.siteId, DST) })).toEqual([expect.objectContaining({ name: '10 classes', credits: 10 })])

    const shopOn = await db.query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, DST), eq(siteSettings.key, 'shop.enabled')) })
    expect(shopOn?.value).toBe(true)
    const shopConfig = await db.query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, DST), eq(siteSettings.key, 'shop.config')) })
    expect(shopConfig?.value).toMatchObject({ currency: 'GBP', collectionEnabled: true, downloadLimit: expect.any(Number) })

    const photo = await db.query.media.findFirst({ where: eq(media.siteId, DST) })
    expect(photo).toMatchObject({ metadata: { exif: { model: 'X-T5' } }, focalX: 30, focalY: 70 })
  })

  it('overwriting the same site keeps variant ids (past orders\' downloads) and its own file', async () => {
    const { backup } = await takeBackup(SAME)
    // Drop the file from the zip: the variant still has its own.
    const pdf = backup.content.find(c => c.slug === 'guide')!.product!.variants[1]!
    pdf.fileZipPath = null
    const zip = zipSync({ 'backup.json': new TextEncoder().encode(JSON.stringify(backup)) })

    const res = await restore(SAME, zip, { what: 'content', conflictMode: 'overwrite' })
    const db = getCurrentTestDb()
    const variant = await db.query.productVariants.findFirst({ where: eq(productVariants.id, digitalVariantId) })
    expect(variant?.fileKey).toBe(FILE_KEY)
    expect(objects.has(FILE_KEY)).toBe(true)
    expect(res.result.warnings ?? []).not.toContainEqual(expect.stringContaining('download'))
    // The feed's synced nights went with the feed; own nights and the feed are back.
    const cottage = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, SAME), eq(contentItems.slug, 'cottage')) })
    expect(await db.query.availabilityFeeds.findMany({ where: eq(availabilityFeeds.contentItemId, cottage!.id) })).toHaveLength(1)
    expect(await db.query.availabilityBlocks.findMany({ where: and(eq(availabilityBlocks.contentItemId, cottage!.id), isNull(availabilityBlocks.feedId)) })).toHaveLength(1)
    expect(await db.query.availabilityBlocks.findMany({ where: and(eq(availabilityBlocks.contentItemId, cottage!.id), isNotNull(availabilityBlocks.feedId)) })).toHaveLength(0)
    // Same id, same export link: no "paste it again" warning.
    expect(res.result.warnings ?? []).not.toContainEqual(expect.stringContaining('calendar export link'))
  })

  it('leaves out invalid JSON settings and says so when a linked form or tier is missing', async () => {
    const db = getCurrentTestDb()
    const target = 'site-bk-features-partial'
    await seedSite(db, { id: target, domain: 'bk-features-partial.localhost' })
    await seedRole(db, adminId, target, 'admin')
    const { backup } = await takeBackup(SRC)
    backup.settings['podcast.settings'] = { enabled: true, title: '' }
    const zip = zipSync({ 'backup.json': new TextEncoder().encode(JSON.stringify(backup)) })

    // Content and settings only: no forms, no tiers.
    const res = await restore(target, zip, { what: 'content,settings', conflictMode: 'skip' })
    expect(res.result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Podcast settings'),
      expect.stringContaining('intake form "waiver"'),
      expect.stringContaining('"Gold" membership'),
    ]))
    expect(await db.query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, target), eq(siteSettings.key, 'podcast.settings')) })).toBeUndefined()
    const yoga = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, target), eq(contentItems.slug, 'yoga')) })
    expect(yoga?.settings?.intakeFormId).toBeUndefined()
    // Still gated (on a tier nobody can buy) rather than opened up.
    expect(yoga?.settings?.access).toBe(`tier:${goldTierId}`)
  })
})
