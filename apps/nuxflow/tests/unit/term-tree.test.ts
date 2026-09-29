import { describe, it, expect } from 'vitest'
import { flattenTermTree, slugifyTermName, termWithDescendantIds } from '../../app/utils/term-tree'
import { slugify, TAXONOMY_SLUG_RE } from '../../server/utils/taxonomy'

const t = (id: string, parentId: string | null, sortOrder = 0, name = id) => ({ id, parentId, sortOrder, name })

describe('flattenTermTree', () => {
  it('orders parents before children, siblings by sortOrder then name, with depth', () => {
    const out = flattenTermTree([t('b', null, 1), t('a', null, 1), t('first', null, 0), t('a2', 'a', 0, 'z'), t('a1', 'a', 0, 'y')])
    expect(out.map(x => [x.id, x.depth])).toEqual([['first', 0], ['a', 0], ['a1', 1], ['a2', 1], ['b', 0]])
  })

  it('treats a missing parent as top level and still lists terms caught in a cycle', () => {
    const out = flattenTermTree([t('orphan', 'gone'), t('x', 'y'), t('y', 'x')])
    expect(out.map(x => x.id).sort()).toEqual(['orphan', 'x', 'y'])
    expect(out.find(x => x.id === 'orphan')?.depth).toBe(0)
  })
})

describe('termWithDescendantIds', () => {
  it('collects every nested term at any depth', () => {
    const terms = [t('a', null), t('b', 'a'), t('c', 'b'), t('d', null)]
    expect([...termWithDescendantIds(terms, 'a')].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('slugify (server) and slugifyTermName (client) agree', () => {
  it.each([
    ['Café Society', 'cafe-society'],
    ['  Hello,  World!  ', 'hello-world'],
    ['Crème brûlée & co', 'creme-brulee-co'],
    ['日本語', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
    expect(slugifyTermName(input)).toBe(expected)
    if (expected) expect(TAXONOMY_SLUG_RE.test(expected)).toBe(true)
  })
})
