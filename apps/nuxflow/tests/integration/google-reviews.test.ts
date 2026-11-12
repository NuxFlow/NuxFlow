/**
 * Google reviews: the Place ID and the encrypted API key saved from Settings → Business, the
 * Places API answer reduced to what the block shows, and nothing fetched without both.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { siteSettings } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeAllPublicPages: vi.fn().mockResolvedValue(undefined),
  purgeEdgeCache: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitUntil: (_e: unknown, p: Promise<unknown>) => p,
}))

const { default: patchSettings } = await import('../../server/api/v1/settings/index.patch')
const { default: reviewsRoute } = await import('../../server/routes/_nuxflow/google-reviews.get')
const clearSettingsCache = undefined as undefined | ((siteId: string) => void)

const SITE = 'site-google-reviews-01'
let adminId: string
const PLACE = 'ChIJ_test_place_id_123'

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'reviews.localhost' })
  adminId = await seedUser(db, { email: 'admin@reviews.test' })
  await seedRole(db, adminId, SITE, 'admin')
})
afterAll(teardownTestDb)
afterEach(() => vi.unstubAllGlobals())

type Handler = (e: H3Event) => Promise<unknown>
const save = (settings: Record<string, unknown>) => (patchSettings as Handler)(createMockEvent({ siteId: SITE, session: { user: { id: adminId, name: 'A', email: 'admin@reviews.test' } }, body: { settings } }) as unknown as H3Event)
const visitor = () => createMockEvent({ siteId: SITE }) as unknown as H3Event
const empty = { kind: 'LocalBusiness', hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, exceptions: [] }

describe('Google reviews', () => {
  it('fetches nothing until both the Place ID and the key are set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await (reviewsRoute as Handler)(visitor())).toEqual({ reviews: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the key encrypted, and a Place ID on its own is enough to keep', async () => {
    await save({ 'business.profile': { ...empty, googlePlaceId: PLACE }, 'integrations.google_places_key': 'AIza-secret-key' })
    const rows = await getCurrentTestDb().select().from(siteSettings).where(eq(siteSettings.siteId, SITE))
    const key = rows.find(r => r.key === 'integrations.google_places_key')
    expect(JSON.stringify(key?.value)).not.toContain('AIza-secret-key')
    expect(JSON.stringify(rows.find(r => r.key === 'business.profile')?.value)).toContain(PLACE)
  })

  it('asks Google with the key and shows only what the block needs', async () => {
    clearSettingsCache?.(SITE)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      displayName: { text: 'Bean Cafe' },
      rating: 4.66,
      userRatingCount: 128,
      googleMapsUri: 'https://maps.google.com/?cid=1',
      reviews: [
        { rating: 5, text: { text: 'Great coffee <script>' }, relativePublishTimeDescription: '2 weeks ago', authorAttribution: { displayName: 'Ann', uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a' } },
        { rating: 3, originalText: { text: 'Fine' }, authorAttribution: { displayName: 'Bo', uri: 'javascript:alert(1)' } },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { reviews } = await (reviewsRoute as Handler)(visitor()) as { reviews: { rating: number; count: number; url: string; reviews: Array<{ author: string; authorUrl: string | null; text: string }> } }
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe(`https://places.googleapis.com/v1/places/${PLACE}`)
    expect(init.headers['X-Goog-Api-Key']).toBe('AIza-secret-key')
    expect(reviews).toMatchObject({ rating: 4.7, count: 128, url: 'https://maps.google.com/?cid=1' })
    expect(reviews.reviews.map(r => [r.author, r.text, r.authorUrl])).toEqual([
      ['Ann', 'Great coffee <script>', 'https://www.google.com/maps/contrib/1'],
      ['Bo', 'Fine', null],
    ])
  })

  it('shows nothing when Google refuses', async () => {
    clearSettingsCache?.(SITE)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    expect(await (reviewsRoute as Handler)(visitor())).toEqual({ reviews: null })
  })
})
