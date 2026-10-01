import { describe, it, expect } from 'vitest'
import {
  aiBlockDefinitions,
  aiFields,
  buildBlockCatalog,
  normalizeAiBlocks,
  safeAiUrl,
  collectCanvasStrings,
  applyCanvasTranslations,
  type AiCapability,
} from '../../../../packages/canvas/src/ai'
import { CANVAS_BLOCKS, getBlockDefinition } from '../../../../packages/canvas/src/blocks/definitions'
import type { CanvasBlockData } from '../../../../packages/canvas/src/types'

let n = 0
const newId = () => `id-${++n}`
const ALL_CAPS = new Set<AiCapability>(['media', 'forms', 'tiers', 'events', 'posts'])

describe('aiBlockDefinitions', () => {
  it('never offers excluded blocks (layout footer, raw HTML, cookie banner)', () => {
    const ids = aiBlockDefinitions(ALL_CAPS).map(d => d.id)
    expect(ids).not.toContain('canvas-footer')
    expect(ids).not.toContain('html-block/html')
    expect(ids).not.toContain('canvas-gdpr')
  })

  it('only offers blocks whose required site capabilities are present', () => {
    const bare = aiBlockDefinitions(new Set()).map(d => d.id)
    expect(bare).not.toContain('canvas-image')
    expect(bare).not.toContain('dynamic-form/form')
    expect(bare).not.toContain('payments/memberships')
    expect(bare).not.toContain('canvas-posts')
    expect(bare).toContain('contact-form/form')
    expect(bare).toContain('canvas-columns')

    const full = aiBlockDefinitions(ALL_CAPS).map(d => d.id)
    expect(full).toEqual(expect.arrayContaining(['canvas-image', 'canvas-gallery', 'dynamic-form/form', 'payments/memberships', 'canvas-posts', 'canvas-calendar']))
  })

  it('every non-excluded built-in block is reachable with the right capabilities', () => {
    const offered = new Set(aiBlockDefinitions(ALL_CAPS).map(d => d.id))
    const missing = CANVAS_BLOCKS.filter(b => !b.ai?.exclude && !offered.has(b.id)).map(b => b.id)
    expect(missing).toEqual([])
  })
})

describe('buildBlockCatalog', () => {
  const catalog = buildBlockCatalog(aiBlockDefinitions(ALL_CAPS))

  it('describes select options, list item shapes, and slots from the definitions', () => {
    expect(catalog).toMatch(/align \(Alignment\): "left" \| "center" \| "right"/)
    expect(catalog).toMatch(/itemsJson \(Items\): array of \{ question: string, answer: string \}/)
    expect(catalog).toMatch(/canvas-columns[^\n]*\n {2}child slots: col1, col2, col3, col4/)
  })

  it('leaves out padding and fields marked ai: false', () => {
    expect(catalog).not.toMatch(/- padding /)
    expect(catalog).not.toMatch(/- focalX /)
    expect(aiFields(getBlockDefinition('canvas-image')!).map(f => f.key)).not.toContain('focalY')
  })
})

describe('normalizeAiBlocks', () => {
  const defs = aiBlockDefinitions(ALL_CAPS)
  const media = [
    { url: 'https://cdn.example.com/a.jpg', alt: 'Latte art', width: 800, height: 600 },
    { url: 'https://cdn.example.com/b.jpg', alt: 'Shop front' },
  ]

  it('starts from the block\'s defaults and layers validated values on top', () => {
    const [hero] = normalizeAiBlocks([{ type: 'canvas-hero', props: { headline: 'Hi', align: 'diagonal', textColor: '#FFF' } }], { defs, newId })
    const def = getBlockDefinition('canvas-hero')!
    expect(hero!.props.headline).toBe('Hi')
    expect(hero!.props.align).toBe(def.defaultProps.align)
    expect(hero!.props.textColor).toBe('#FFF')
    expect(hero!.props.padding).toEqual(def.defaultProps.padding)
  })

  it('clamps numbers and coerces toggles', () => {
    const [spacer] = normalizeAiBlocks([{ type: 'canvas-spacer', props: { height: 9999, showLine: 'true' } }], { defs, newId })
    expect(spacer!.props.height).toBe(400)
    expect(spacer!.props.showLine).toBe(true)
  })

  it('resolves media tokens and only accepts library images', () => {
    const [image, gallery] = normalizeAiBlocks([
      { type: 'canvas-image', props: { src: 'media:0' } },
      { type: 'canvas-gallery', props: { images: ['media:1', 'https://evil.example/x.jpg', { url: 'media:0' }] } },
    ], { defs, media, newId })
    expect(image!.props.src).toEqual({ url: 'https://cdn.example.com/a.jpg', width: 800, height: 600 })
    expect(JSON.parse(gallery!.props.images as string)).toEqual([
      { url: 'https://cdn.example.com/b.jpg', alt: 'Shop front' },
      { url: 'https://cdn.example.com/a.jpg', alt: 'Latte art' },
    ])
  })

  it('nests children one level deep and raises a Columns count to cover filled slots', () => {
    const [columns] = normalizeAiBlocks([{
      type: 'canvas-columns',
      props: { columns: '2' },
      children: [
        { slot: 'col1', blocks: [{ type: 'canvas-text', props: { content: '<p>One</p>' } }] },
        { slot: 'col3', blocks: [{ type: 'canvas-button', props: { label: 'Go' } }] },
        { slot: 'col9', blocks: [{ type: 'canvas-text', props: {} }] },
        { slot: 'col2', blocks: [{ type: 'canvas-columns', props: {} }] },
      ],
    }], { defs, newId })
    expect(Object.keys(columns!.children!)).toEqual(['col1', 'col3'])
    expect(columns!.props.columns).toBe('3')
  })
})

describe('safeAiUrl', () => {
  it.each([
    ['/contact', '/contact'],
    ['#pricing', '#pricing'],
    ['https://example.com', 'https://example.com'],
    ['mailto:hi@example.com', 'mailto:hi@example.com'],
    ['javascript:alert(1)', undefined],
    ['data:text/html,x', undefined],
  ])('%s → %s', (input, expected) => {
    expect(safeAiUrl(input)).toBe(expected)
  })
})

describe('collectCanvasStrings / applyCanvasTranslations', () => {
  const blocks: CanvasBlockData[] = [
    { id: 'p', type: 'canvas-pricing', props: { title: 'Plans', plan1Price: '29', plan1Features: JSON.stringify(['Fast', 'Cheap']), plan1BtnUrl: '/buy' } },
    { id: 'f', type: 'canvas-footer', props: { col1Links: JSON.stringify([{ label: 'Home', url: '/' }]) } },
    { id: 'x', type: 'some-plugin/block', props: { title: 'Plugin title', color: 'red' } },
  ]

  it('collects copy only — never prices, URLs, or a plugin block\'s non-copy props', () => {
    const strings = collectCanvasStrings(blocks)
    expect([...strings.keys()].sort()).toEqual(['f.col1Links.0.label', 'p.plan1Features.0', 'p.plan1Features.1', 'p.title', 'x.title'])
  })

  it('writes translations back into the JSON lists without disturbing other items', () => {
    const out = applyCanvasTranslations(blocks, { 'p.plan1Features.1': 'Barato', 'f.col1Links.0.label': 'Inicio', 'p.title': 'Planes', 'p.plan1Features.7': 'out of range' })
    expect(out[0]!.props.title).toBe('Planes')
    expect(JSON.parse(out[0]!.props.plan1Features as string)).toEqual(['Fast', 'Barato'])
    expect(JSON.parse(out[1]!.props.col1Links as string)).toEqual([{ label: 'Inicio', url: '/' }])
    expect(out[0]!.props.plan1Price).toBe('29')
  })
})
