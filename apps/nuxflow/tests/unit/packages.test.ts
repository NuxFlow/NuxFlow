/**
 * Unit tests for workspace-package code that previously had no tests of its own:
 *  - @nuxflow/cli signing ↔ server verification contract (the two sides keep separate
 *    copies of the canonical signing input; if they drift, every plugin install fails)
 *  - @nuxflow/canvas HTML sanitizers and safeHref (the v-html / :href XSS chokepoints)
 *  - @nuxflow/canvas JSON and block-tree helpers
 */
import { describe, it, expect } from 'vitest'
import * as cliSigning from '../../../../packages/cli/src/utils/signing'
import { verifyPluginSignature, computeSha256 as serverSha256 } from '../../server/utils/plugin-signing'
import { sanitizeRichText, sanitizeCustomHtml, safeHref } from '../../../../packages/canvas/src/utils/sanitize-html'
import { safeJsonParse, parseImageList, normalizeImageValue } from '../../../../packages/canvas/src/utils/json'
import { findBlockById, findParentList, getSlotChildren, isDescendant, cloneWithNewIds } from '../../../../packages/canvas/src/tree'
import type { CanvasBlockData } from '../../../../packages/canvas/src/types'

describe('CLI signing ↔ server verification', () => {
  const payload = {
    id: 'com.example.plugin',
    version: '1.2.3',
    serverChecksum: 'a'.repeat(64),
    clientChecksum: 'none',
    definitionsChecksum: 'b'.repeat(64),
  }

  it('computes identical SHA-256 checksums on both sides', async () => {
    const code = 'export default { fetch() {} } // ✓ unicode'
    expect(await cliSigning.computeSha256(code)).toBe(await serverSha256(code))
  })

  it('a CLI-signed payload verifies on the server', async () => {
    const keys = await cliSigning.generateKeyPair()
    const sig = await cliSigning.signPayload(keys.privateKey, payload)
    expect(await verifyPluginSignature(keys.publicKey, payload, sig)).toBe(true)
  })

  it.each(Object.keys(payload))('changing %s invalidates the signature', async (field) => {
    const keys = await cliSigning.generateKeyPair()
    const sig = await cliSigning.signPayload(keys.privateKey, payload)
    const tampered = { ...payload, [field]: `${(payload as Record<string, string>)[field]}x` }
    expect(await verifyPluginSignature(keys.publicKey, tampered, sig)).toBe(false)
  })

  it('rejects a signature from a different key', async () => {
    const a = await cliSigning.generateKeyPair()
    const b = await cliSigning.generateKeyPair()
    const sig = await cliSigning.signPayload(a.privateKey, payload)
    expect(await verifyPluginSignature(b.publicKey, payload, sig)).toBe(false)
  })
})

describe('canvas sanitizers', () => {
  it.each([
    ['<p>hi<script>alert(1)</script></p>', '<p>hi</p>'],
    ['<img src="/_nuxflow/media/a.png" onerror="alert(1)">', '<img src="/_nuxflow/media/a.png">'],
    ['<a href="javascript:alert(1)">x</a>', '<a href>x</a>'],
    ['<p style="x">a</p><style>body{}</style>', '<p>a</p>'],
    ['<iframe src="https://evil.test"></iframe>', ''],
    ['<svg><script>alert(1)</script></svg>', ''],
  ])('rich text: %s', (input, expected) => {
    expect(sanitizeRichText(input)).toBe(expected)
  })

  it('rich text keeps legitimate formatting', () => {
    const html = '<h2>T</h2><p><strong>b</strong> <a href="https://x.test" target="_blank" rel="noopener">l</a></p><ol start="3"><li>i</li></ol>'
    expect(sanitizeRichText(html)).toBe(html)
    expect(sanitizeRichText(null)).toBe('')
  })

  it('custom HTML allows embeds but still strips scripts and handlers', () => {
    expect(sanitizeCustomHtml('<iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe>'))
      .toBe('<iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe>')
    const out = sanitizeCustomHtml('<div class="c" onclick="x()"><script>1</script><iframe src="javascript:alert(1)"></iframe></div>')
    expect(out).not.toMatch(/onclick|<script|javascript:/i)
  })

  it.each([
    ['javascript:alert(1)', '#'],
    ['JaVaScRiPt:alert(1)', '#'],
    ['\x01javascript:alert(1)', '#'],
    ['java\tscript:alert(1)', '#'],
    ['  vbscript:msgbox', '#'],
    ['data:text/html,<script>', '#'],
    ['https://example.com', 'https://example.com'],
    ['/relative/path', '/relative/path'],
    ['mailto:a@b.test', 'mailto:a@b.test'],
    ['', ''],
  ])('safeHref(%j) → %j', (input, expected) => {
    expect(safeHref(input)).toBe(expected)
  })
})

describe('canvas json helpers', () => {
  it('safeJsonParse falls back on empty or invalid input', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
    expect(safeJsonParse('{oops', 'fb')).toBe('fb')
    expect(safeJsonParse(null, [])).toEqual([])
  })

  it('parseImageList keeps only url-bearing objects', () => {
    expect(parseImageList(JSON.stringify([{ url: 'a' }, { alt: 'no url' }, null, 'str', { url: 5 }, { url: 'b', alt: 'B', width: 10 }])))
      .toEqual([{ url: 'a' }, { url: 'b', alt: 'B', width: 10 }])
    expect(parseImageList('{"url":"not-an-array"}')).toEqual([])
    expect(parseImageList('garbage')).toEqual([])
  })

  it('normalizeImageValue reads both the legacy string and the object shape', () => {
    expect(normalizeImageValue('https://x/a.png')).toEqual({ url: 'https://x/a.png' })
    expect(normalizeImageValue({ url: 'u', width: 1, height: 2, extra: true })).toEqual({ url: 'u', width: 1, height: 2 })
    expect(normalizeImageValue(null)).toEqual({ url: '' })
    expect(normalizeImageValue({ width: 1 })).toEqual({ url: '' })
  })
})

describe('canvas block tree', () => {
  const tree = (): CanvasBlockData[] => [
    { id: 'a', type: 'text', props: {} },
    {
      id: 'cols', type: 'columns', props: { gap: 4 },
      children: {
        left: [{ id: 'l1', type: 'text', props: { t: 1 } }],
        right: [{ id: 'inner', type: 'container', props: {}, children: { main: [{ id: 'deep', type: 'text', props: {} }] } }],
      },
    },
  ]

  it('finds blocks and their containing list at any depth', () => {
    const t = tree()
    expect(findBlockById(t, 'deep')?.type).toBe('text')
    const loc = findParentList(t, 'l1')
    expect(loc?.index).toBe(0)
    expect(loc?.list).toBe(t[1]!.children!.left)
    expect(findBlockById(t, 'missing')).toBeNull()
  })

  it('reads slot children without materialising empty slots', () => {
    const t = tree()
    expect(getSlotChildren(t[1]!, 'left')).toHaveLength(1)
    expect(getSlotChildren(t[0]!, 'left')).toEqual([])
    expect(t[0]!.children).toBeUndefined()
  })

  it('detects descendants (cycle guard for moves)', () => {
    const t = tree()
    expect(isDescendant(t, 'cols', 'deep')).toBe(true)
    expect(isDescendant(t, 'cols', 'cols')).toBe(true)
    expect(isDescendant(t, 'inner', 'l1')).toBe(false)
    expect(isDescendant(t, 'missing', 'a')).toBe(false)
  })

  it('clones deeply with a fresh id on every node and no shared props', () => {
    let n = 0
    const original = tree()[1]!
    const clone = cloneWithNewIds(original, () => `new-${++n}`)
    const ids: string[] = []
    const walk = (b: CanvasBlockData) => { ids.push(b.id); Object.values(b.children ?? {}).flat().forEach(walk) }
    walk(clone)
    expect(ids).toEqual(['new-1', 'new-2', 'new-3', 'new-4'])
    ;(clone.children!.left![0]!.props as { t: number }).t = 99
    expect((original.children!.left![0]!.props as { t: number }).t).toBe(1)
  })
})
