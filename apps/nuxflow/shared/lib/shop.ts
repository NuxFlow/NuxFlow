/**
 * The shop's pure rules, shared by the server, the admin editor and the public pages:
 * variant names and combinations, prices shown, stock messages. Import-free (apart from the
 * equally pure money helpers) so it's easy to test.
 */
import { formatMoney } from './money'

export const MAX_OPTIONS = 3
export const MAX_OPTION_VALUES = 30
export const MAX_VARIANTS = 100
/** Stock at or below this says "only N left". */
export const LOW_STOCK = 5

export type ProductKind = 'physical' | 'digital'

export interface ProductVariantData {
  id: string
  sku: string | null
  /** One value per option name, in order. */
  options: string[]
  priceMinor: number
  compareAtMinor: number | null
  /** Null: not tracked. */
  stock: number | null
  weightGrams: number | null
  kind: ProductKind
  imageUrl: string | null
  isActive: boolean
}

export interface ShopSettings {
  enabled: boolean
  /** ISO code, upper case: every price in the shop is in it. */
  currency: string
  /** UK/EU habit: prices include tax. US habit: tax is added at checkout. */
  pricesIncludeTax: boolean
  /** Stripe Tax works out and collects tax (an extra Stripe fee per sale). */
  stripeTax: boolean
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  enabled: false,
  currency: 'GBP',
  pricesIncludeTax: true,
  stripeTax: false,
}

/** "M / Blue", or "" for a product with no options. */
export function variantLabel(options: readonly string[]): string {
  return options.filter(Boolean).join(' / ')
}

/**
 * Every combination of the options' values, in the order a shop owner reads them:
 * [["S","Red"], ["S","Blue"], ["M","Red"], …]. One empty combination when there are none.
 */
export function optionCombinations(values: readonly (readonly string[])[]): string[][] {
  return values.reduce<string[][]>(
    (combos, list) => combos.flatMap(combo => list.map(value => [...combo, value])),
    [[]],
  )
}

/** Same values in the same order: the same variant. Case and spacing don't count. */
export function sameOptions(a: readonly string[], b: readonly string[]): boolean {
  const norm = (v: string) => v.trim().toLowerCase()
  return a.length === b.length && a.every((v, i) => norm(v) === norm(b[i] ?? ''))
}

export type StockState = 'in_stock' | 'low' | 'out'

export function stockState(stock: number | null): StockState {
  if (stock === null) return 'in_stock'
  if (stock <= 0) return 'out'
  return stock <= LOW_STOCK ? 'low' : 'in_stock'
}

export function stockMessage(stock: number | null, kind: ProductKind = 'physical'): string {
  if (kind === 'digital' || stock === null) return 'In stock'
  if (stock <= 0) return 'Out of stock'
  return stock <= LOW_STOCK ? `Only ${stock} left` : 'In stock'
}

/** The variants a visitor can choose. */
export function sellableVariants<T extends Pick<ProductVariantData, 'isActive'>>(variants: readonly T[]): T[] {
  return variants.filter(v => v.isActive)
}

/** "£12.00", or "From £12.00" when the variants differ, or "" when nothing is on sale. */
export function priceLabel(variants: readonly Pick<ProductVariantData, 'priceMinor' | 'isActive'>[], currency: string, locale?: string): string {
  const prices = sellableVariants(variants).map(v => v.priceMinor)
  if (!prices.length) return ''
  const min = Math.min(...prices)
  const label = formatMoney(min, currency, locale)
  return prices.some(p => p !== min) ? `From ${label}` : label
}

/**
 * Checks a product's options and variants as the editor sends them. Returns the first problem
 * in words fit for the editor, or null.
 */
export function productProblem(optionNames: readonly string[], variants: readonly Pick<ProductVariantData, 'options' | 'sku' | 'priceMinor' | 'compareAtMinor'>[]): string | null {
  if (optionNames.length > MAX_OPTIONS) return `A product can have up to ${MAX_OPTIONS} options.`
  const names = optionNames.map(n => n.trim().toLowerCase())
  if (names.some(n => !n)) return 'Every option needs a name, such as Size.'
  if (new Set(names).size !== names.length) return 'Two options have the same name.'
  if (!variants.length) return 'A product needs at least one variant.'
  if (variants.length > MAX_VARIANTS) return `A product can have up to ${MAX_VARIANTS} variants.`
  for (const v of variants) {
    if (v.options.length !== optionNames.length || v.options.some(o => !o.trim())) return 'Every variant needs a value for each option.'
    if (v.priceMinor < 0) return 'A price can\'t be below zero.'
    if (v.compareAtMinor !== null && v.compareAtMinor <= v.priceMinor) return 'A "was" price has to be more than the price.'
  }
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      if (sameOptions(variants[i]!.options, variants[j]!.options)) return `Two variants are both "${variantLabel(variants[i]!.options) || 'the default'}".`
    }
  }
  const skus = variants.map(v => v.sku?.trim().toLowerCase()).filter((s): s is string => Boolean(s))
  if (new Set(skus).size !== skus.length) return 'Two variants have the same SKU.'
  return null
}
