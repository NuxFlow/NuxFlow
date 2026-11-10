import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { z } from 'zod'
import { contentTypes, taxonomies, taxonomyContentTypes, contentItems, siteSettings } from '@nuxflow/db/schema'
import { CURRENCY_RE } from '../../shared/lib/money'
import { DEFAULT_SHOP_SETTINGS, type ShopSettings } from '../../shared/lib/shop'
import { useDb, type Db } from './db'
import { requireSiteId } from './site-context'
import { batchSaveSettings, resolveBooleanSetting, resolveSetting, settingToBoolean } from './settings'
import { planIncludes } from './hosting-plans'
import { purgeAllPublicPages } from './edge-cache'

/**
 * The shop switch and its settings. Off by default: a site sees nothing of the shop until an
 * admin turns it on in Admin → Shop, and on a hosting platform only when its plan includes
 * it (`allow_shop`). Turning it on adds the `product` content type and the Collections
 * taxonomy; turning it off hides the shop but deletes nothing.
 */

export const SHOP_ENABLED_KEY = 'shop.enabled'
export const SHOP_CONFIG_KEY = 'shop.config'

export const shopConfigSchema = z.object({
  currency: z.string().trim().toUpperCase().regex(CURRENCY_RE, 'Use a three-letter currency code, such as GBP'),
  pricesIncludeTax: z.boolean(),
  stripeTax: z.boolean(),
})

export type ShopConfig = z.infer<typeof shopConfigSchema>

/** The stored config, read leniently: anything missing or broken is the default. */
export function parseShopConfig(value: unknown): ShopConfig {
  const base = { currency: DEFAULT_SHOP_SETTINGS.currency, pricesIncludeTax: DEFAULT_SHOP_SETTINGS.pricesIncludeTax, stripeTax: DEFAULT_SHOP_SETTINGS.stripeTax }
  if (!value || typeof value !== 'object') return base
  const parsed = shopConfigSchema.partial().safeParse(value)
  return parsed.success ? { ...base, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) } : base
}

/** Whether the shop is on for this site: switched on, and (on a hosting platform) in its plan. */
export async function isShopOn(event: H3Event): Promise<boolean> {
  if (!(await resolveBooleanSetting(event, SHOP_ENABLED_KEY))) return false
  return planIncludes(useDb(event), requireSiteId(event), 'shop')
}

export async function getShopSettings(event: H3Event): Promise<ShopSettings> {
  const [enabled, config] = await Promise.all([isShopOn(event), resolveSetting(event, SHOP_CONFIG_KEY)])
  return { enabled, ...parseShopConfig(config) }
}

/**
 * The same, from the database alone, for code with no request at hand (the page API's
 * cached builder). Shop settings are never encrypted, so no decryption is needed.
 */
export async function getShopSettingsFromDb(db: Db, siteId: string): Promise<ShopSettings> {
  const [rows, inPlan] = await Promise.all([
    db.query.siteSettings.findMany({ where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, [SHOP_ENABLED_KEY, SHOP_CONFIG_KEY])) }),
    planIncludes(db, siteId, 'shop'),
  ])
  const value = (key: string) => rows.find(r => r.key === key)?.value
  return { enabled: inPlan && settingToBoolean(value(SHOP_ENABLED_KEY)), ...parseShopConfig(value(SHOP_CONFIG_KEY)) }
}

/** 404 when the shop is off, so a site without one looks like it has none. */
export async function requireShopOn(event: H3Event): Promise<void> {
  if (!(await isShopOn(event))) notFound('This site has no shop.')
}

export async function assertPlanIncludesShop(event: H3Event): Promise<void> {
  if (!(await planIncludes(useDb(event), requireSiteId(event), 'shop'))) {
    httpError({ status: 403, message: 'Your plan doesn\'t include a shop. Ask about a bigger plan.', data: { code: 'plan_feature', feature: 'shop' } })
  }
}

/**
 * The `product` content type and the `collection` taxonomy, made the first time the shop
 * is turned on and left alone after that (a site can rename them). Safe to run again.
 */
export async function ensureShopContent(db: Db, siteId: string): Promise<{ productTypeId: string }> {
  let type = await db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'product')), columns: { id: true } })
  if (!type) {
    const id = ulid()
    await db.insert(contentTypes).values({
      id,
      siteId,
      slug: 'product',
      name: 'Products',
      singularName: 'Product',
      icon: 'i-lucide-shopping-bag',
      isBuiltIn: true,
      hasRevisions: true,
      hasComments: false,
    }).onConflictDoNothing()
    type = await db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'product')), columns: { id: true } }) ?? { id }
  }

  const existing = await db.query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, 'collection')), columns: { id: true } })
  // A page already at /collection would clash with the collections overview, so then the
  // site makes its own taxonomy for products in Admin → Taxonomies instead.
  const slugTaken = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, 'collection')), columns: { id: true } })
  if (!existing && !slugTaken) {
    const taxonomyId = ulid()
    await db.insert(taxonomies).values({ id: taxonomyId, siteId, slug: 'collection', name: 'Collections', description: 'Groups of products, such as "New in" or "Prints".', isHierarchical: true }).onConflictDoNothing()
    await db.insert(taxonomyContentTypes).values({ taxonomyId, contentTypeId: type.id }).onConflictDoNothing()
  }
  return { productTypeId: type.id }
}

/** Admin → Shop: switch on or off, and save the settings. */
export async function saveShopSettings(event: H3Event, input: { enabled?: boolean; config?: ShopConfig }): Promise<ShopSettings> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const entries: [string, unknown][] = []
  if (input.enabled) {
    await assertPlanIncludesShop(event)
    await ensureShopContent(db, siteId)
  }
  if (input.enabled !== undefined) entries.push([SHOP_ENABLED_KEY, input.enabled])
  if (input.config) entries.push([SHOP_CONFIG_KEY, input.config])
  if (entries.length) {
    await batchSaveSettings(event, entries)
    // Prices, the cart and product pages all change with these, and they're cached whole.
    await purgeAllPublicPages(event, siteId)
  }
  return getShopSettings(event)
}
