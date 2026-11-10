import type { H3Event } from 'h3'
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { z } from 'zod'
import { contentItems, contentTaxonomyTerms, contentTypes, products, productVariants, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { MAX_OPTION_VALUES, MAX_OPTIONS, MAX_VARIANTS, priceLabel, productProblem, sellableVariants, stockMessage, stockState, variantLabel, type StockState } from '../../shared/lib/shop'
import { formatMoney } from '../../shared/lib/money'
import type { Db } from './db'
import { assertWithinPlan } from './hosting-plans'
import { assertPlanIncludesShop } from './shop'
import { publicPathForItem } from './seo'

/**
 * A product's options, variants and extra images (the side tables in schema/shop.ts). The
 * editor saves them with the post, as `product` on content POST/PATCH, like `termIds`.
 */

export type ProductRow = typeof products.$inferSelect
export type VariantRow = typeof productVariants.$inferSelect

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

const optionText = z.string().trim().min(1).max(60)

export const productInputSchema = z.object({
  optionNames: z.array(optionText).max(MAX_OPTIONS),
  images: z.array(z.object({ url: z.string().trim().min(1).max(2048), alt: z.string().max(300).optional() })).max(30),
  variants: z.array(z.object({
    // Made by the editor, so an autosave in flight can't create the same variant twice.
    id: z.string().regex(ULID_RE, 'Each variant needs an id'),
    sku: z.string().trim().max(64).nullish(),
    options: z.array(optionText).max(MAX_OPTIONS),
    priceMinor: z.number().int().min(0).max(100_000_000),
    compareAtMinor: z.number().int().min(1).max(100_000_000).nullish(),
    // Null: not tracked.
    stock: z.number().int().min(0).max(10_000_000).nullable(),
    // What the editor last loaded. A change is applied as a difference from it, so stock
    // taken by a sale while the editor was open isn't put back by the next autosave.
    stockWas: z.number().int().min(0).nullable().optional(),
    weightGrams: z.number().int().min(0).max(1_000_000).nullish(),
    kind: z.enum(['physical', 'digital']),
    imageUrl: z.string().trim().max(2048).nullish(),
    isActive: z.boolean(),
  })).min(1).max(MAX_VARIANTS),
})

export type ProductInput = z.infer<typeof productInputSchema>

/** What a new product starts with: one variant, no options. */
export function defaultProductInput(id: string): ProductInput {
  return { optionNames: [], images: [], variants: [{ id, sku: null, options: [], priceMinor: 0, compareAtMinor: null, stock: null, weightGrams: null, kind: 'physical', imageUrl: null, isActive: true }] }
}

export async function loadProduct(db: Db, siteId: string, itemId: string): Promise<{ product: ProductRow | null; variants: VariantRow[] }> {
  const [product, variants] = await Promise.all([
    db.query.products.findFirst({ where: and(eq(products.contentItemId, itemId), eq(products.siteId, siteId)) }),
    db.query.productVariants.findMany({
      where: and(eq(productVariants.contentItemId, itemId), eq(productVariants.siteId, siteId)),
      orderBy: [asc(productVariants.sortOrder), asc(productVariants.id)],
    }),
  ])
  return { product: product ?? null, variants }
}

/** The editor's view of a product (GET /api/v1/content/:id), or null for a non-product. */
export function productForEditor(loaded: { product: ProductRow | null; variants: VariantRow[] }) {
  if (!loaded.product) return null
  return {
    optionNames: loaded.product.optionNames,
    images: loaded.product.images,
    variants: loaded.variants.map(v => ({
      id: v.id,
      sku: v.sku,
      options: v.options,
      priceMinor: v.priceMinor,
      compareAtMinor: v.compareAtMinor,
      stock: v.stock,
      weightGrams: v.weightGrams,
      kind: v.kind,
      imageUrl: v.imageUrl,
      isActive: v.isActive,
    })),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface ProductSavePlan {
  changed: boolean
  statements: BatchItem<'sqlite'>[]
}

/**
 * Works out the writes that bring a product's stored data to `input`, or none when nothing
 * differs (autosave sends the whole form every few seconds). Throws a validation error the
 * editor shows as is. A product's first save checks the plan includes the shop and has room.
 */
export async function planProductSave(event: H3Event, db: Db, siteId: string, itemId: string, input: ProductInput): Promise<ProductSavePlan> {
  const problem = productProblem(input.optionNames, input.variants.map(v => ({ ...v, sku: v.sku ?? null, compareAtMinor: v.compareAtMinor ?? null })))
  if (problem) validationError(problem)
  const tooManyValues = input.optionNames.some((_, i) => new Set(input.variants.map(v => v.options[i]?.toLowerCase())).size > MAX_OPTION_VALUES)
  if (tooManyValues) validationError(`An option can have up to ${MAX_OPTION_VALUES} values.`)

  const existing = await loadProduct(db, siteId, itemId)
  if (!existing.product) {
    await assertPlanIncludesShop(event)
    await assertWithinPlan(event, 'products')
  }

  const known = new Map(existing.variants.map(v => [v.id, v]))
  const fresh = input.variants.filter(v => !known.has(v.id)).map(v => v.id)
  if (fresh.length) {
    // Ids are global, so one sent for another product (or site) must not take that row over.
    const taken = await db.select({ id: productVariants.id }).from(productVariants).where(inArray(productVariants.id, fresh))
    if (taken.length) validationError('A variant id is already in use. Reload the editor and try again.')
  }
  const skus = input.variants.map(v => v.sku?.trim()).filter((s): s is string => Boolean(s))
  if (skus.length) {
    const clash = await db.select({ sku: productVariants.sku }).from(productVariants)
      .where(and(eq(productVariants.siteId, siteId), inArray(productVariants.sku, skus), sql`${productVariants.contentItemId} <> ${itemId}`))
      .limit(1)
    if (clash[0]) validationError(`Another product already uses the SKU ${clash[0].sku}.`)
  }

  const now = new Date().toISOString()
  const statements: BatchItem<'sqlite'>[] = []
  let changed = !existing.product

  if (!existing.product) {
    statements.push(db.insert(products).values({ contentItemId: itemId, siteId, optionNames: input.optionNames, images: input.images }))
  }
  else if (!same(existing.product.optionNames, input.optionNames) || !same(existing.product.images, input.images)) {
    changed = true
    statements.push(db.update(products).set({ optionNames: input.optionNames, images: input.images, updatedAt: now })
      .where(and(eq(products.contentItemId, itemId), eq(products.siteId, siteId))))
  }

  input.variants.forEach((v, sortOrder) => {
    const fields = {
      sku: v.sku?.trim() || null,
      options: v.options,
      priceMinor: v.priceMinor,
      compareAtMinor: v.compareAtMinor ?? null,
      weightGrams: v.weightGrams ?? null,
      kind: v.kind,
      imageUrl: v.imageUrl?.trim() || null,
      isActive: v.isActive,
      sortOrder,
    }
    const old = known.get(v.id)
    if (!old) {
      changed = true
      statements.push(db.insert(productVariants).values({ id: v.id, siteId, contentItemId: itemId, stock: v.stock, ...fields }))
      return
    }
    const fieldsChanged = (Object.keys(fields) as (keyof typeof fields)[]).some(k => !same(fields[k], old[k]))
    const was = v.stockWas !== undefined ? v.stockWas : old.stock
    const stockChanged = v.stock !== was
    if (!fieldsChanged && !stockChanged) return
    changed = true
    let stock: VariantRow['stock'] | ReturnType<typeof sql> | undefined
    if (stockChanged) {
      // Tracked before and after: move by the editor's difference, whatever sales did meanwhile.
      stock = v.stock !== null && was !== null
        ? sql`case when ${productVariants.stock} is null then ${v.stock} else max(0, ${productVariants.stock} + ${v.stock - was}) end`
        : v.stock
    }
    statements.push(db.update(productVariants)
      .set({ ...fields, ...(stock !== undefined ? { stock } : {}), updatedAt: now })
      .where(and(eq(productVariants.id, v.id), eq(productVariants.siteId, siteId), eq(productVariants.contentItemId, itemId))))
  })

  const keep = input.variants.map(v => v.id)
  if (existing.variants.some(v => !keep.includes(v.id))) {
    changed = true
    statements.push(db.delete(productVariants).where(and(eq(productVariants.contentItemId, itemId), eq(productVariants.siteId, siteId), notInArray(productVariants.id, keep))))
  }
  return { changed, statements }
}

// ── What visitors see ───────────────────────────────────────────────────────

export interface PublicVariant {
  id: string
  options: string[]
  label: string
  priceMinor: number
  compareAtMinor: number | null
  price: string
  compareAt: string | null
  kind: VariantRow['kind']
  imageUrl: string | null
  /** At the time the page was cached; the page asks again for the live stock. */
  available: boolean
}

export interface PublicProduct {
  id: string
  currency: string
  pricesIncludeTax: boolean
  optionNames: string[]
  images: { url: string; alt?: string }[]
  variants: PublicVariant[]
  priceLabel: string
  available: boolean
}

export function toPublicProduct(itemId: string, loaded: { product: ProductRow | null; variants: VariantRow[] }, shop: { currency: string; pricesIncludeTax: boolean }, locale?: string): PublicProduct | null {
  if (!loaded.product) return null
  const variants = sellableVariants(loaded.variants).map(v => ({
    id: v.id,
    options: v.options,
    label: variantLabel(v.options),
    priceMinor: v.priceMinor,
    compareAtMinor: v.compareAtMinor,
    price: formatMoney(v.priceMinor, shop.currency, locale),
    compareAt: v.compareAtMinor ? formatMoney(v.compareAtMinor, shop.currency, locale) : null,
    kind: v.kind,
    imageUrl: v.imageUrl,
    available: stockState(v.stock) !== 'out',
  }))
  return {
    id: itemId,
    currency: shop.currency,
    pricesIncludeTax: shop.pricesIncludeTax,
    optionNames: loaded.product.optionNames,
    images: loaded.product.images,
    variants,
    priceLabel: priceLabel(loaded.variants, shop.currency, locale),
    available: variants.some(v => v.available),
  }
}

/** Live stock for a product page (which is cached whole), without saying how many are left unless few are. */
export async function liveStock(db: Db, siteId: string, itemId: string): Promise<{ id: string; state: StockState; message: string }[]> {
  const variants = await db.query.productVariants.findMany({
    where: and(eq(productVariants.contentItemId, itemId), eq(productVariants.siteId, siteId), eq(productVariants.isActive, true)),
    columns: { id: true, stock: true, kind: true },
  })
  return variants.map(v => ({ id: v.id, state: v.kind === 'digital' ? 'in_stock' : stockState(v.stock), message: stockMessage(v.stock, v.kind) }))
}

export interface ProductCard {
  id: string
  title: string
  path: string
  excerpt: string | null
  image: string | null
  price: string
  compareAt: string | null
  available: boolean
}

/**
 * Published public products for the Products and Product blocks, newest first: all of them,
 * one collection's (sub-collections included), or the ones named by slug.
 */
export async function listProductCards(db: Db, siteId: string, opts: { limit: number; collection?: string; slugs?: string[]; currency: string; locale: string }): Promise<ProductCard[]> {
  const type = await db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'product')), columns: { id: true } })
  if (!type) return []
  let termIds: string[] | null = null
  if (opts.collection) {
    const terms = await db.select({ id: taxonomyTerms.id, parentId: taxonomyTerms.parentId, slug: taxonomyTerms.slug })
      .from(taxonomyTerms)
      .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
      .where(and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, 'collection')))
    const root = terms.find(t => t.slug === opts.collection)
    if (!root) return []
    // The collection and everything under it; the walk can't loop, as each term is visited once.
    const ids = new Set([root.id])
    for (let grew = true; grew;) {
      grew = false
      for (const t of terms) if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) { ids.add(t.id); grew = true }
    }
    termIds = [...ids]
  }
  const items = await db.select({ id: contentItems.id, title: contentItems.title, slug: contentItems.slug, excerpt: contentItems.excerpt, ogImage: contentItems.ogImage })
    .from(contentItems)
    .where(and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
      isNull(contentItems.sourceItemId),
      opts.slugs?.length ? inArray(contentItems.slug, opts.slugs) : undefined,
      termIds ? inArray(contentItems.id, db.select({ id: contentTaxonomyTerms.contentItemId }).from(contentTaxonomyTerms).where(inArray(contentTaxonomyTerms.termId, termIds))) : undefined,
    ))
    .orderBy(desc(contentItems.publishedAt), desc(contentItems.id))
    .limit(opts.limit)
  if (!items.length) return []
  const variants = await db.query.productVariants.findMany({
    where: and(eq(productVariants.siteId, siteId), inArray(productVariants.contentItemId, items.map(i => i.id)), eq(productVariants.isActive, true)),
  })
  const cards = items.map((item) => {
    const own = variants.filter(v => v.contentItemId === item.id)
    const cheapest = own.slice().sort((a, b) => a.priceMinor - b.priceMinor)[0]
    return {
      id: item.id,
      title: item.title,
      path: publicPathForItem({ slug: item.slug }, opts.locale),
      excerpt: item.excerpt,
      image: item.ogImage,
      price: priceLabel(own, opts.currency, opts.locale),
      compareAt: cheapest?.compareAtMinor ? formatMoney(cheapest.compareAtMinor, opts.currency, opts.locale) : null,
      available: own.some(v => stockState(v.stock) !== 'out'),
      hasVariants: own.length > 0,
    }
  })
  // A product with nothing on sale isn't shown.
  const shown = cards.filter(c => c.hasVariants).map(({ hasVariants: _, ...card }) => card)
  return opts.slugs?.length ? opts.slugs.map(s => shown.find(c => c.path === publicPathForItem({ slug: s }, opts.locale))).filter((c): c is ProductCard => Boolean(c)) : shown
}
