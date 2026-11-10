import { describe, it, expect } from 'vitest'
import { addToBasket, basketTotals, MAX_LINE_QUANTITY, optionCombinations, priceLabel, productProblem, sameOptions, stockMessage, stockState, variantLabel } from '../../shared/lib/shop'

const v = (options: string[], over: Partial<{ sku: string | null; priceMinor: number; compareAtMinor: number | null }> = {}) => ({ options, sku: null, priceMinor: 1000, compareAtMinor: null, ...over })

describe('options and variants', () => {
  it('makes every combination, in reading order', () => {
    expect(optionCombinations([['S', 'M'], ['Red', 'Blue']])).toEqual([['S', 'Red'], ['S', 'Blue'], ['M', 'Red'], ['M', 'Blue']])
    expect(optionCombinations([])).toEqual([[]])
  })

  it('names a variant by its values', () => {
    expect(variantLabel(['M', 'Blue'])).toBe('M / Blue')
    expect(variantLabel([])).toBe('')
  })

  it('treats case and spacing as the same variant', () => {
    expect(sameOptions(['M ', 'blue'], ['m', 'Blue'])).toBe(true)
    expect(sameOptions(['M'], ['L'])).toBe(false)
  })

  it('finds what\'s wrong with a product before it\'s saved', () => {
    expect(productProblem([], [v([])])).toBeNull()
    expect(productProblem(['Size'], [v(['S']), v(['M'])])).toBeNull()
    expect(productProblem(['Size', 'size'], [v(['S', 'S'])])).toMatch(/same name/)
    expect(productProblem(['Size'], [v([])])).toMatch(/value for each option/)
    expect(productProblem(['Size'], [v(['S']), v(['s'])])).toMatch(/both "S"/)
    expect(productProblem([], [v([], { compareAtMinor: 900 })])).toMatch(/"was" price/)
    expect(productProblem(['Size'], [v(['S'], { sku: 'A' }), v(['M'], { sku: 'a' })])).toMatch(/same SKU/)
    expect(productProblem([], [])).toMatch(/at least one variant/)
  })
})

describe('prices and stock shown', () => {
  it('says "From" only when variants differ, and ignores ones off sale', () => {
    expect(priceLabel([{ priceMinor: 1200, isActive: true }, { priceMinor: 1200, isActive: true }], 'GBP')).toBe('£12.00')
    expect(priceLabel([{ priceMinor: 1500, isActive: true }, { priceMinor: 1200, isActive: true }], 'GBP')).toBe('From £12.00')
    expect(priceLabel([{ priceMinor: 900, isActive: false }, { priceMinor: 1200, isActive: true }], 'GBP')).toBe('£12.00')
    expect(priceLabel([{ priceMinor: 900, isActive: false }], 'GBP')).toBe('')
  })

  it('only says how many are left when few are', () => {
    expect(stockState(null)).toBe('in_stock')
    expect(stockState(0)).toBe('out')
    expect(stockState(3)).toBe('low')
    expect(stockState(50)).toBe('in_stock')
    expect(stockMessage(2)).toBe('Only 2 left')
    expect(stockMessage(0, 'digital')).toBe('In stock')
  })
})

describe('the basket', () => {
  const shipping = { shippingRateMinor: 395, freeShippingOverMinor: 5000 }

  it('charges delivery only when something is posted, and not over the free threshold', () => {
    expect(basketTotals([{ quantity: 2, unitMinor: 1000, isDigital: false }], shipping)).toEqual({ subtotalMinor: 2000, needsShipping: true, shippingMinor: 395 })
    expect(basketTotals([{ quantity: 5, unitMinor: 1000, isDigital: false }], shipping)).toMatchObject({ shippingMinor: 0 })
    expect(basketTotals([{ quantity: 1, unitMinor: 800, isDigital: true }], shipping)).toEqual({ subtotalMinor: 800, needsShipping: false, shippingMinor: 0 })
    expect(basketTotals([{ quantity: 1, unitMinor: 9000, isDigital: false }], { shippingRateMinor: 395, freeShippingOverMinor: null })).toMatchObject({ shippingMinor: 395 })
  })

  it('merges the same variant into one line, within the most allowed', () => {
    const once = addToBasket([], { variantId: 'a', quantity: 2 })
    const twice = addToBasket(once, { variantId: 'a', quantity: 3 })
    expect(twice).toEqual([{ variantId: 'a', quantity: 5 }])
    expect(addToBasket(twice, { variantId: 'a', quantity: 99 })[0]!.quantity).toBe(MAX_LINE_QUANTITY)
    expect(addToBasket(twice, { variantId: 'b', quantity: 1 })).toHaveLength(2)
  })
})

describe('Product structured data', () => {
  it('gives one Offer for one variant and an AggregateOffer for several', async () => {
    const { buildPageJsonLd } = await import('../../app/utils/seo')
    const page = { title: 'Tote', url: 'https://shop.test/tote', type: { slug: 'product', name: 'Product' } }
    const one = buildPageJsonLd({ ...page, product: { currency: 'GBP', variants: [{ id: 'a', label: '', priceMinor: 1250, amount: '12.50', available: true }] } }, { name: 'Shop', base: 'https://shop.test' })
    expect(one[0]).toMatchObject({ '@type': 'Product', offers: { '@type': 'Offer', price: '12.50', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' } })
    const many = buildPageJsonLd({ ...page, product: { currency: 'GBP', variants: [
      { id: 'a', label: 'L', priceMinor: 1500, amount: '15.00', available: false },
      { id: 'b', label: 'S', priceMinor: 1200, amount: '12.00', available: false },
    ] } }, { name: 'Shop', base: 'https://shop.test' })
    expect(many[0]).toMatchObject({ offers: { '@type': 'AggregateOffer', lowPrice: '12.00', highPrice: '15.00', offerCount: 2, availability: 'https://schema.org/OutOfStock' } })
  })
})
