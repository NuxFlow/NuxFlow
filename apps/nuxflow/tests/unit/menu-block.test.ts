import { describe, it, expect } from 'vitest'
import { extractMenus, menuSections, parseDietary, parseMenuItems, priceNumber, usedDietaryCodes } from '@nuxflow/canvas/menu'
import { getBlockDefinition } from '../../../../packages/canvas/src/blocks/definitions'
import { buildPageJsonLd } from '../../app/utils/seo'

const items = JSON.stringify([
  { section: 'Breakfast', name: 'Toast', description: 'Sourdough', price: '£4.50', dietary: 'v' },
  { section: '', name: 'Avocado', price: '£8', dietary: 'VG, gf, nonsense' },
  { section: 'Drinks', name: 'Flat white', price: '3,20 €' },
  { section: 'Drinks', name: 'Tea', price: '' },
  { section: 'Sides', name: '', price: '£2' },
])

describe('menu items', () => {
  it('reads dietary codes, known ones only, once each', () => {
    expect(parseDietary('vg, GF / s; vg x')).toEqual(['VG', 'GF', 'S'])
    expect(parseDietary(undefined)).toEqual([])
  })

  it('groups dishes into sections, carrying a section down until a new one starts', () => {
    const sections = menuSections(parseMenuItems(items))
    expect(sections.map(s => [s.title, s.items.map(i => i.name)])).toEqual([
      ['Breakfast', ['Toast', 'Avocado']],
      ['Drinks', ['Flat white', 'Tea']],
    ])
  })

  it('builds the key from the labels actually used', () => {
    expect(usedDietaryCodes(parseMenuItems(items)).map(d => d.code)).toEqual(['V', 'VG', 'GF'])
  })

  it('reads prices written different ways', () => {
    expect(priceNumber('£8.50')).toBe(8.5)
    expect(priceNumber('3,20 €')).toBe(3.2)
    expect(priceNumber('POA')).toBeNull()
  })
})

describe('schema.org Menu', () => {
  const content = { type: 'canvas', blocks: [{ id: 'c', type: 'canvas-columns', props: {}, children: { col1: [{ id: 'm', type: 'canvas-menu', props: { title: 'Lunch', itemsJson: items, currency: 'gbp' } }] } }] }

  it('describes sections, prices and suitable diets', () => {
    const [menu] = extractMenus(content) as Array<{ name: string; hasMenuSection: Array<{ name: string; hasMenuItem: Array<Record<string, unknown>> }> }>
    expect(menu!.name).toBe('Lunch')
    const avocado = menu!.hasMenuSection[0]!.hasMenuItem[1]!
    expect(avocado).toMatchObject({ name: 'Avocado', offers: { price: '8.00', priceCurrency: 'GBP' } })
    expect(avocado.suitableForDiet).toEqual(['https://schema.org/VeganDiet', 'https://schema.org/GlutenFreeDiet'])
    expect(menu!.hasMenuSection[1]!.hasMenuItem[1]).not.toHaveProperty('offers')
  })

  it('is added to the page’s structured data', () => {
    const out = buildPageJsonLd({ title: 'Our menu', url: 'https://cafe.test/menu', content, type: { slug: 'page', name: 'Page' } }, { name: 'Cafe', base: 'https://cafe.test' })
    expect(out.some(j => (j as { '@type'?: string })['@type'] === 'Menu')).toBe(true)
  })
})

describe('canvas-menu block', () => {
  it('never translates prices or dietary codes', () => {
    const def = getBlockDefinition('canvas-menu')!
    const list = def.fields.find(f => f.key === 'itemsJson')!
    expect(list.fields!.find(f => f.key === 'price')!.translatable).toBe(false)
    expect(list.fields!.find(f => f.key === 'dietary')!.translatable).toBe(false)
  })
})
