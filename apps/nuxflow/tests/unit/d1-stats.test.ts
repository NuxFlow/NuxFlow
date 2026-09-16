import { describe, it, expect, vi } from 'vitest'
import type { H3Event } from 'h3'

interface FakeSite { id: string; name: string; domain: string }
interface FakeContentRow { siteId: string; count: number; bytes: number }
interface FakeMediaRow { siteId: string; count: number; bytes: number; localCount: number }

// A minimal stand-in for the real D1Database binding — matches the same
// prepare(sql).all() -> { results } contract used by tests/unit/d1-export.test.ts,
// tailored to the specific query shapes getD1SizeStats() issues (sites list plus three
// GROUP BY aggregates). No PRAGMA page_count/page_size here — D1 doesn't support either
// (see the module doc in d1-stats.ts for how that was found out the hard way).
function makeFakeD1(opts: {
  sites: FakeSite[]
  content: FakeContentRow[]
  revisions: FakeContentRow[]
  media: FakeMediaRow[]
}) {
  return {
    prepare(sql: string) {
      return {
        async all() {
          if (sql.includes('FROM sites')) return { results: opts.sites, success: true, meta: {} }
          if (sql.includes('FROM content_revisions')) return { results: opts.revisions, success: true, meta: {} }
          if (sql.includes('FROM content_items')) return { results: opts.content, success: true, meta: {} }
          if (sql.includes('FROM media')) return { results: opts.media, success: true, meta: {} }
          throw new Error(`Unexpected SQL against fake D1: ${sql}`)
        },
      }
    },
  }
}

function mkEvent() {
  return {} as unknown as H3Event
}

describe('getD1SizeStats()', () => {
  it('sums every site\'s approximate bytes into the whole-database figure', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        sites: [
          { id: 'site-a', name: 'Site A', domain: 'a.example.com' },
          { id: 'site-b', name: 'Site B', domain: 'b.example.com' },
        ],
        content: [
          { siteId: 'site-a', count: 5, bytes: 1000 },
          { siteId: 'site-b', count: 1, bytes: 100 },
        ],
        revisions: [],
        media: [],
      }),
    }))
    const { getD1SizeStats } = await import('../../server/utils/d1-stats')

    const stats = await getD1SizeStats(mkEvent())
    expect(stats.approxDatabaseSizeBytes).toBe(1000 + 100)
  })

  it('joins per-site content/revision/media aggregates and flags local-fallback media', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        sites: [
          { id: 'site-a', name: 'Site A', domain: 'a.example.com' },
          { id: 'site-b', name: 'Site B', domain: 'b.example.com' },
        ],
        content: [
          { siteId: 'site-a', count: 5, bytes: 1000 },
          { siteId: 'site-b', count: 1, bytes: 100 },
        ],
        revisions: [
          { siteId: 'site-a', count: 12, bytes: 3000 },
        ],
        media: [
          { siteId: 'site-a', count: 3, bytes: 300, localCount: 0 },
          { siteId: 'site-b', count: 2, bytes: 50_000, localCount: 2 },
        ],
      }),
    }))
    const { getD1SizeStats } = await import('../../server/utils/d1-stats')

    const stats = await getD1SizeStats(mkEvent())
    const siteA = stats.sites.find(s => s.siteId === 'site-a')!
    const siteB = stats.sites.find(s => s.siteId === 'site-b')!

    expect(siteA.contentItemCount).toBe(5)
    expect(siteA.revisionCount).toBe(12)
    expect(siteA.localFallbackMediaCount).toBe(0)
    expect(siteA.approxTotalBytes).toBe(1000 + 3000 + 300)

    // Site B has no revisions row at all — must default to 0, not throw or drop the site.
    expect(siteB.revisionCount).toBe(0)
    expect(siteB.revisionBytes).toBe(0)
    expect(siteB.localFallbackMediaCount).toBe(2)
  })

  it('sorts sites by approximate total size, descending', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        sites: [
          { id: 'small', name: 'Small', domain: 'small.example.com' },
          { id: 'big', name: 'Big', domain: 'big.example.com' },
        ],
        content: [
          { siteId: 'small', count: 1, bytes: 10 },
          { siteId: 'big', count: 1, bytes: 10_000 },
        ],
        revisions: [],
        media: [],
      }),
    }))
    const { getD1SizeStats } = await import('../../server/utils/d1-stats')

    const stats = await getD1SizeStats(mkEvent())
    expect(stats.sites.map(s => s.siteId)).toEqual(['big', 'small'])
  })

  it('caches the computed stats per isolate so a second call does not re-scan D1', async () => {
    vi.resetModules()
    let prepareCalls = 0
    const fakeD1 = makeFakeD1({
      sites: [{ id: 'site-a', name: 'Site A', domain: 'a.example.com' }],
      content: [{ siteId: 'site-a', count: 1, bytes: 100 }],
      revisions: [],
      media: [],
    })
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => ({
        prepare(sql: string) {
          prepareCalls++
          return fakeD1.prepare(sql)
        },
      }),
    }))
    const { getD1SizeStats } = await import('../../server/utils/d1-stats')

    const first = await getD1SizeStats(mkEvent())
    const callsAfterFirst = prepareCalls
    expect(callsAfterFirst).toBeGreaterThan(0)

    const second = await getD1SizeStats(mkEvent())

    // No new D1 queries were issued for the second call — it was served from cache.
    expect(prepareCalls).toBe(callsAfterFirst)
    expect(second).toEqual(first)
  })
})
