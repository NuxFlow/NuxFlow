import { describe, it, expect } from 'vitest'
import { aiBlockDefinitions, applyAiPageEdits, describePageForAi, type AiCapability, type AiPageEditOp } from '../../../../packages/canvas/src/ai'
import type { CanvasBlockData } from '../../../../packages/canvas/src/types'

let n = 0
const newId = () => `new-${++n}`
const defs = aiBlockDefinitions(new Set<AiCapability>(['media', 'forms', 'tiers', 'events', 'posts']))
const media = [{ url: 'https://cdn.example.com/a.jpg', alt: 'Latte art' }]

function page(): CanvasBlockData[] {
  return [
    { id: 'hero', type: 'canvas-hero', props: { headline: 'Welcome to Bean', subtext: 'Coffee', textColor: '#ffffff', padding: { top: 64 } } },
    { id: 'text', type: 'canvas-text', props: { content: '<p>About us</p>' } },
    { id: 'cols', type: 'canvas-columns', props: { columns: '2' }, children: { col1: [{ id: 'inner', type: 'canvas-text', props: { content: '<p>Left</p>' } }] } },
    { id: 'foot', type: 'canvas-footer', props: { copyright: '© Bean' } },
  ]
}

function run(ops: AiPageEditOp[], blocks = page()) {
  const { labels, text } = describePageForAi(blocks, defs, media)
  return { text, labels, ...applyAiPageEdits(blocks, ops, { defs, media, labels, newId }) }
}

describe('describePageForAi', () => {
  it('labels every block (children too) and marks blocks AI may not edit', () => {
    const { text, labels } = describePageForAi(page(), defs, media)
    expect([...labels]).toEqual([['b1', 'hero'], ['b2', 'text'], ['b3', 'cols'], ['b4', 'inner'], ['b5', 'foot']])
    expect(text).toContain('b4 canvas-text  (inside b3, slot col1)')
    expect(text).toContain('b5 canvas-footer — cannot be edited by AI')
    expect(text).toContain('Welcome to Bean')
    // Padding is the editor's business and never shown.
    expect(text).not.toContain('padding')
  })

  it('shows library images as tokens and never leaks other URLs', () => {
    const { text } = describePageForAi([
      { id: 'i1', type: 'canvas-image', props: { src: { url: 'https://cdn.example.com/a.jpg' } } },
      { id: 'i2', type: 'canvas-image', props: { src: { url: 'https://elsewhere.example/b.jpg' } } },
    ], defs, media)
    expect(text).toContain('media:0')
    expect(text).not.toContain('elsewhere.example')
  })

  it('cuts very long values and says so', () => {
    const { text } = describePageForAi([{ id: 't', type: 'canvas-text', props: { content: 'x'.repeat(5000) } }], defs)
    expect(text).toContain('cut short')
    expect(text.length).toBeLessThan(2000)
  })
})

describe('applyAiPageEdits', () => {
  it('changes only the fields named and keeps everything else (ids, padding, colours)', () => {
    const r = run([{ op: 'update', block: 'b1', props: { headline: 'Great coffee' }, note: 'Shorter heading' }])
    const hero = r.blocks[0]!
    expect(hero.id).toBe('hero')
    expect(hero.props).toEqual({ headline: 'Great coffee', subtext: 'Coffee', textColor: '#ffffff', padding: { top: 64 } })
    expect(r.changes).toEqual([{ kind: 'updated', blockId: 'hero', blockName: expect.any(String), note: 'Shorter heading', fields: [expect.any(String)] }])
  })

  it('refuses invalid values, unknown fields and no-op updates', () => {
    const r = run([
      { op: 'update', block: 'b1', props: { textColor: 'red', nonsense: 'x' } },
      { op: 'update', block: 'b1', props: { headline: 'Welcome to Bean' } },
    ])
    expect(r.blocks[0]!.props.textColor).toBe('#ffffff')
    expect(r.changes).toEqual([])
    expect(r.skipped).toBe(2)
  })

  it('never touches a block AI may not edit', () => {
    const r = run([
      { op: 'update', block: 'b5', props: { copyright: 'hacked' } },
      { op: 'remove', block: 'b5' },
      { op: 'move', block: 'b5', after: '' },
    ])
    expect(r.blocks.at(-1)).toEqual(page().at(-1))
    expect(r.skipped).toBe(3)
  })

  it('updates and removes nested blocks', () => {
    const r = run([{ op: 'update', block: 'b4', props: { content: '<p>Right</p>' } }])
    expect(r.blocks[2]!.children!.col1![0]!.props.content).toBe('<p>Right</p>')
    const removed = run([{ op: 'remove', block: 'b4', note: 'Not needed' }])
    expect(removed.blocks[2]!.children!.col1).toEqual([])
    expect(removed.changes[0]!.kind).toBe('removed')
  })

  it('inserts a validated new block after a top-level block, or at the top', () => {
    const r = run([
      { op: 'insert', after: 'b1', type: 'canvas-text', props: { content: '<p>New</p>' }, note: 'Intro' },
      { op: 'insert', after: '', type: 'canvas-button', props: { label: 'Order', url: 'javascript:alert(1)' } },
      { op: 'insert', after: 'b1', type: 'canvas-made-up', props: {} },
    ])
    expect(r.blocks.map(b => b.type).slice(0, 3)).toEqual(['canvas-button', 'canvas-hero', 'canvas-text'])
    expect(r.blocks[2]!.props.content).toBe('<p>New</p>')
    expect(r.blocks[0]!.props.url).not.toBe('javascript:alert(1)')
    expect(r.changes.filter(c => c.kind === 'added')).toHaveLength(2)
    expect(r.skipped).toBe(1)
  })

  it('moves a top-level block and ignores moves that change nothing', () => {
    const r = run([{ op: 'move', block: 'b2', after: '' }, { op: 'move', block: 'b1', after: 'b2' }])
    expect(r.blocks.map(b => b.id)).toEqual(['text', 'hero', 'cols', 'foot'])
    expect(r.changes).toHaveLength(1)
    expect(r.skipped).toBe(1)
  })

  it('ignores unknown labels and junk, and never changes the page it was given', () => {
    const original = page()
    const r = run([{ op: 'remove', block: 'b99' }, null as unknown as AiPageEditOp, { op: 'explode' as 'remove', block: 'b1' }], original)
    expect(r.blocks).toEqual(page())
    expect(r.skipped).toBe(3)
    applyAiPageEdits(original, [{ op: 'remove', block: 'b1' }], { defs, labels: describePageForAi(original, defs).labels, newId })
    expect(original).toEqual(page())
  })

  it('drops an update to a block that was then removed', () => {
    const r = run([{ op: 'update', block: 'b2', props: { content: '<p>x</p>' } }, { op: 'remove', block: 'b2' }])
    expect(r.changes.map(c => c.kind)).toEqual(['removed'])
  })
})
