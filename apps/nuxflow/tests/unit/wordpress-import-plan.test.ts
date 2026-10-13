import { describe, it, expect } from 'vitest'
import { batchItems, buildTermSlugMap, categoryParentLinks, chunk, collectImageUrls } from '../../shared/lib/wordpress-import'
import type { WpCategory } from '../../shared/lib/wxr-parser'

// Run in the browser before the export is sent to the server in batches.
describe('WordPress import planning', () => {
  it('maps nicenames to clean, unique slugs across the whole file', () => {
    const map = buildTermSlugMap([['News', 'News'], ['news', 'news'], ['%e6%97%a5', '日記'], ['', '']])
    expect(map.get('News')).toBe('news')
    expect(map.get('news')).toBe('news-2')
    expect(map.get('%e6%97%a5')).toBe('term')
    expect(map.get('')).toBe('term-2')
  })

  it('links categories to parents, dropping only the links that form a loop', () => {
    const categories = new Map<string, WpCategory>([
      ['a', { name: 'A', parentSlug: 'b' }],
      ['b', { name: 'B', parentSlug: 'a' }],
      ['c', { name: 'C', parentSlug: 'a' }],
      ['d', { name: 'D', parentSlug: null }],
      ['e', { name: 'E', parentSlug: 'unknown' }],
    ])
    const slugs = buildTermSlugMap([...categories].map(([n, c]) => [n, c.name]))
    expect(categoryParentLinks(categories, slugs)).toEqual([{ slug: 'c', parentSlug: 'a' }])
  })

  it('collects attachment and inline image URLs once each', () => {
    const urls = collectImageUrls({
      attachments: [{ title: '', slug: '', url: 'https://wp.test/a.jpg', postId: '1' }, { title: '', slug: '', url: 'ftp://x/y', postId: null }],
      items: [{ content: '<img src="https://wp.test/a.jpg"><img class="x" src=\'https://wp.test/b.png\'>' } as never],
    })
    expect(urls).toEqual(['https://wp.test/a.jpg', 'https://wp.test/b.png'])
  })

  it('batches by count and by size, giving an oversized item a batch of its own', () => {
    const items = [{ content: 'a'.repeat(10) }, { content: 'b'.repeat(10) }, { content: 'c'.repeat(100) }, { content: 'd' }]
    expect(batchItems(items, 2, 50).map(b => b.length)).toEqual([2, 1, 1])
    expect(batchItems(items, 10, 1000).map(b => b.length)).toEqual([4])
    expect(batchItems([], 10, 1000)).toEqual([])
  })

  it('chunks a list', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
