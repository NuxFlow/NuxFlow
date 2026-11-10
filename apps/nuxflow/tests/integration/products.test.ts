/**
 * Products (Stage 1 of the shop): the shop switch and what it sets up, products saved with
 * the post (variants, options, stock edited as a difference), plan limits, and what the
 * public page, the blocks and the live-stock read return.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, contentTaxonomyTerms, contentTypes, hostingPlans, productVariants, products, sites, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeContentCache: vi.fn().mockResolvedValue(undefined),
  purgeAllPublicPages: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const { default: shopGet } = await import('../../server/api/v1/shop/index.get')
const { default: shopPost } = await import('../../server/api/v1/shop/index.post')
const { default: createContent } = await import('../../server/api/v1/content/index.post')
const { default: patchContent } = await import('../../server/api/v1/content/[id].patch')
const { default: getContent } = await import('../../server/api/v1/content/[id].get')
const { default: publicShop } = await import('../../server/api/public/shop/index.get')
const { default: publicPage } = await import('../../server/api/public/pages/[...slug].get')
const { default: me } = await import('../../server/api/v1/users/me.get')
const { clearHostingPlanCache } = await import('../../server/utils/hosting-plans')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')

type Handler = (e: H3Event) => Promise<unknown>
interface Variant { id: string; sku: string | null; options: string[]; priceMinor: number; compareAtMinor: number | null; stock: number | null; stockWas?: number | null; weightGrams: number | null; kind: 'physical' | 'digital'; imageUrl: string | null; isActive: boolean }
interface ProductInput { optionNames: string[]; images: { url: string }[]; variants: Variant[] }

const PRIMARY = 'site-shop-primary'
const SITE = 'site-shop-01'
const PLANLESS = 'site-shop-noplan'
let adminId: string
let editorId: string
let seq = 0

const db = () => getCurrentTestDb()

function ev(opts: { siteId?: string; userId?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string>; method?: string } = {}) {
  const siteId = opts.siteId ?? SITE
  return createMockEvent({
    siteId,
    session: opts.userId ? { user: { id: opts.userId, name: 'U', email: 'u@shop.test' } } : undefined,
    body: opts.body,
    params: opts.params,
    query: opts.query,
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { host: `${siteId}.localhost` },
  }) as unknown as H3Event
}

const variant = (over: Partial<Variant> = {}): Variant => ({ id: ulid(), sku: null, options: [], priceMinor: 1500, compareAtMinor: null, stock: null, weightGrams: null, kind: 'physical', imageUrl: null, isActive: true, ...over })

async function newProduct(product?: ProductInput, over: Record<string, unknown> = {}, siteId = SITE) {
  const slug = `tote-${++seq}`
  const result = await (createContent as Handler)(ev({ siteId, userId: adminId, body: { title: 'Linen tote', slug, typeSlug: 'product', status: 'published', ...(product ? { product } : {}), ...over } })) as { id: string }
  return { id: result.id, slug }
}

const patch = (id: string, body: Record<string, unknown>, siteId = SITE) => (patchContent as Handler)(ev({ siteId, userId: adminId, params: { id }, body, method: 'PATCH' })) as Promise<{ id: string; version: number }>
const variantsOf = (itemId: string) => db().query.productVariants.findMany({ where: eq(productVariants.contentItemId, itemId), orderBy: (v, { asc }) => [asc(v.sortOrder)] })
const turnOn = (siteId = SITE) => (shopPost as Handler)(ev({ siteId, userId: adminId, body: { action: 'settings', enabled: true } }))

beforeAll(async () => {
  await initTestDb()
  await seedSite(db(), { id: PRIMARY, domain: 'primary.shop.test', isPrimary: true })
  await seedSite(db(), { id: SITE, domain: `${SITE}.localhost` })
  await seedSite(db(), { id: PLANLESS, domain: `${PLANLESS}.localhost` })
  adminId = await seedUser(db(), { email: 'admin@shop.test' })
  editorId = await seedUser(db(), { email: 'editor@shop.test' })
  for (const site of [SITE, PLANLESS]) await seedRole(db(), adminId, site, 'admin')
  await seedRole(db(), editorId, SITE, 'editor')
  await turnOn()
})

afterAll(teardownTestDb)

describe('the shop switch', () => {
  it('adds the product type and a Collections taxonomy for products, once', async () => {
    await turnOn()
    const types = await db().query.contentTypes.findMany({ where: and(eq(contentTypes.siteId, SITE), eq(contentTypes.slug, 'product')) })
    expect(types).toHaveLength(1)
    const collection = await db().query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, SITE), eq(taxonomies.slug, 'collection')) })
    expect(collection).toMatchObject({ name: 'Collections', isHierarchical: true })
  })

  it('reports the shop to the admin menu, and saves its settings', async () => {
    expect(await (me as Handler)(ev({ userId: adminId }))).toMatchObject({ shop: true })
    await (shopPost as Handler)(ev({ userId: adminId, body: { action: 'settings', config: { currency: 'eur', pricesIncludeTax: false, stripeTax: true } } }))
    const { settings } = await (shopGet as Handler)(ev({ userId: editorId })) as { settings: Record<string, unknown> }
    expect(settings).toEqual({ enabled: true, currency: 'EUR', pricesIncludeTax: false, stripeTax: true })
    await (shopPost as Handler)(ev({ userId: adminId, body: { action: 'settings', config: { currency: 'GBP', pricesIncludeTax: true, stripeTax: false } } }))
  })

  it('is for admins to change', async () => {
    await expect((shopPost as Handler)(ev({ userId: editorId, body: { action: 'settings', enabled: false } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('needs a plan that includes it on a hosting platform', async () => {
    await seedSetting(db(), PRIMARY, 'platform.hosting_enabled', true)
    clearHostingPlatformCache()
    const planId = ulid()
    await db().insert(hostingPlans).values({ id: planId, name: 'Starter' })
    await db().update(sites).set({ hostingPlanId: planId }).where(eq(sites.id, PLANLESS))
    clearHostingPlanCache()
    await expect(turnOn(PLANLESS)).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_feature' } })

    await db().update(hostingPlans).set({ allowShop: true, maxProducts: 1 }).where(eq(hostingPlans.id, planId))
    clearHostingPlanCache()
    await turnOn(PLANLESS)
    await newProduct(undefined, {}, PLANLESS)
    await expect(newProduct(undefined, {}, PLANLESS)).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit' } })

    await db().update(sites).set({ hostingPlanId: null }).where(eq(sites.id, PLANLESS))
    await seedSetting(db(), PRIMARY, 'platform.hosting_enabled', false)
    clearHostingPlatformCache()
    clearHostingPlanCache()
  })
})

describe('saving a product with the post', () => {
  it('starts a product with one variant when none is sent', async () => {
    const { id } = await newProduct()
    expect(await variantsOf(id)).toEqual([expect.objectContaining({ options: [], priceMinor: 0, stock: null, kind: 'physical' })])
    const loaded = await (getContent as Handler)(ev({ userId: editorId, params: { id } })) as { product: ProductInput; shopCurrency: string }
    expect(loaded.product.variants).toHaveLength(1)
    expect(loaded.shopCurrency).toBe('GBP')
  })

  it('saves options and variants, and an unchanged save writes nothing', async () => {
    const product = { optionNames: ['Size'], images: [{ url: '/img/a.jpg' }], variants: [variant({ options: ['S'], sku: 'TOTE-S' }), variant({ options: ['M'], sku: 'TOTE-M', priceMinor: 1700 })] }
    const { id } = await newProduct(product)
    const first = await patch(id, { product })
    const again = await patch(id, { product })
    expect(again.version).toBe(first.version)
    expect((await variantsOf(id)).map(v => v.sku)).toEqual(['TOTE-S', 'TOTE-M'])

    const changed = await patch(id, { product: { ...product, variants: [product.variants[0], { ...product.variants[1]!, priceMinor: 1800 }] } })
    expect(changed.version).toBe(first.version + 1)
    expect((await variantsOf(id))[1]?.priceMinor).toBe(1800)
  })

  it('applies a stock change as a difference, so sales made meanwhile aren\'t undone', async () => {
    const v = variant({ stock: 10 })
    const { id } = await newProduct({ optionNames: [], images: [], variants: [v] })
    // Three sold while the editor was open.
    await db().update(productVariants).set({ stock: 7 }).where(eq(productVariants.id, v.id))
    // The editor loaded 10 and the owner typed 12: two more arrived.
    await patch(id, { product: { optionNames: [], images: [], variants: [{ ...v, stock: 12, stockWas: 10 }] } })
    expect((await variantsOf(id))[0]?.stock).toBe(9)
    // An autosave that didn't touch stock leaves it alone.
    await patch(id, { title: 'Linen tote bag', product: { optionNames: [], images: [], variants: [{ ...v, stock: 12, stockWas: 12 }] } })
    expect((await variantsOf(id))[0]?.stock).toBe(9)
  })

  it('removes variants dropped from the list', async () => {
    const a = variant({ options: ['Red'] })
    const b = variant({ options: ['Blue'] })
    const { id } = await newProduct({ optionNames: ['Colour'], images: [], variants: [a, b] })
    await patch(id, { product: { optionNames: ['Colour'], images: [], variants: [a] } })
    expect((await variantsOf(id)).map(v => v.id)).toEqual([a.id])
  })

  it('refuses two variants alike, a missing option value, and another product\'s variant or SKU', async () => {
    const { id } = await newProduct({ optionNames: ['Size'], images: [], variants: [variant({ options: ['S'], sku: 'UNIQUE-1' })] })
    await expect(patch(id, { product: { optionNames: ['Size'], images: [], variants: [variant({ options: ['S'] }), variant({ options: ['s'] })] } })).rejects.toMatchObject({ statusCode: 422 })
    await expect(patch(id, { product: { optionNames: ['Size'], images: [], variants: [variant({ options: [] })] } })).rejects.toMatchObject({ statusCode: 422 })

    const other = await newProduct()
    const stolen = (await variantsOf(id))[0]!
    await expect(patch(other.id, { product: { optionNames: ['Size'], images: [], variants: [variant({ id: stolen.id, options: ['S'] })] } })).rejects.toMatchObject({ statusCode: 422 })
    await expect(patch(other.id, { product: { optionNames: [], images: [], variants: [variant({ sku: 'UNIQUE-1' })] } })).rejects.toMatchObject({ statusCode: 422 })
    expect((await variantsOf(id))[0]?.contentItemId).toBe(id)
  })

  it('ignores product data on anything that isn\'t a product', async () => {
    const page = await (createContent as Handler)(ev({ userId: adminId, body: { title: 'About', slug: `about-${++seq}`, typeSlug: 'product-less', product: { optionNames: [], images: [], variants: [variant()] } } })).catch(e => e)
    expect(page).toMatchObject({ statusCode: 404 })
  })
})

describe('what visitors see', () => {
  async function publishedProduct() {
    const s = variant({ options: ['S'], priceMinor: 1200, stock: 0 })
    const m = variant({ options: ['M'], priceMinor: 1500, stock: 3, compareAtMinor: 2000 })
    const created = await newProduct({ optionNames: ['Size'], images: [{ url: '/img/b.jpg' }], variants: [s, m] })
    return { ...created, s, m }
  }

  it('puts the product on its page, priced in the shop\'s currency', async () => {
    const { slug, s, m } = await publishedProduct()
    const page = await (publicPage as Handler)(ev({ params: { slug } })) as { product: { priceLabel: string; variants: { id: string; price: string; compareAt: string | null; available: boolean }[] } }
    expect(page.product.priceLabel).toBe('From £12.00')
    expect(page.product.variants).toEqual([
      expect.objectContaining({ id: s.id, price: '£12.00', available: false }),
      expect.objectContaining({ id: m.id, price: '£15.00', compareAt: '£20.00', available: true }),
    ])
  })

  it('gives live stock without exact numbers unless few are left', async () => {
    const { id, s, m } = await publishedProduct()
    const { variants } = await (publicShop as Handler)(ev({ query: { product: id } })) as { variants: { id: string; state: string; message: string }[] }
    expect(variants).toEqual(expect.arrayContaining([
      { id: s.id, state: 'out', message: 'Out of stock' },
      { id: m.id, state: 'low', message: 'Only 3 left' },
    ]))
  })

  it('lists products for the blocks, by collection with its sub-collections', async () => {
    const { id, slug } = await publishedProduct()
    const tax = await db().query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, SITE), eq(taxonomies.slug, 'collection')) })
    const parent = ulid()
    const child = ulid()
    await db().insert(taxonomyTerms).values([
      { id: parent, taxonomyId: tax!.id, slug: 'bags', name: 'Bags' },
      { id: child, taxonomyId: tax!.id, slug: 'totes', name: 'Totes', parentId: parent },
    ])
    await db().insert(contentTaxonomyTerms).values({ contentItemId: id, termId: child })

    const { products: inBags } = await (publicShop as Handler)(ev({ query: { collection: 'bags' } })) as { products: { id: string; price: string; path: string }[] }
    expect(inBags.map(p => p.id)).toEqual([id])
    expect(inBags[0]).toMatchObject({ price: 'From £12.00', path: `/${slug}` })
    const { products: bySlug } = await (publicShop as Handler)(ev({ query: { slugs: slug } })) as { products: { id: string }[] }
    expect(bySlug.map(p => p.id)).toEqual([id])
  })

  it('leaves out drafts', async () => {
    const { id } = await publishedProduct()
    await db().update(contentItems).set({ status: 'draft' }).where(eq(contentItems.id, id))
    const { products: list } = await (publicShop as Handler)(ev({ query: { limit: '48' } })) as { products: { id: string }[] }
    expect(list.map(p => p.id)).not.toContain(id)
  })

  it('hides everything once the shop is off', async () => {
    const { slug } = await publishedProduct()
    await (shopPost as Handler)(ev({ userId: adminId, body: { action: 'settings', enabled: false } }))
    await expect((publicShop as Handler)(ev({ query: {} }))).rejects.toMatchObject({ statusCode: 404 })
    const page = await (publicPage as Handler)(ev({ params: { slug } })) as { product: unknown }
    expect(page.product).toBeNull()
    expect(await db().query.products.findMany({ where: eq(products.siteId, SITE) })).not.toHaveLength(0)
    await turnOn()
  })
})
