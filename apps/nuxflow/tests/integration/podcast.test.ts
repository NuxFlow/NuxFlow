/**
 * The podcast: Settings → Podcast checked on save, the /podcast.xml feed (episodes are public
 * items of the chosen type with audio; enclosure sizes from the library; Apple's tags), and
 * an episode's audio on the page API.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia } from '../helpers/seed'
import { durationSeconds, parseEpisode } from '../../shared/lib/podcast'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/analytics', () => ({ trackPageView: vi.fn() }))
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
const { default: feedRoute } = await import('../../server/routes/podcast.xml')
const { default: publicPage } = await import('../../server/api/public/pages/[...slug].get')

const SITE = 'site-podcast-01'
let adminId: string
let postType: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'pod.localhost' })
  adminId = await seedUser(db, { email: 'admin@pod.test' })
  await seedRole(db, adminId, SITE, 'admin')
  postType = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  await seedMedia(db, SITE, { url: '/_nuxflow/media/ep1.mp3', mimeType: 'audio/mpeg', size: 12345678, originalName: 'ep1.mp3' })
  await seedContentItem(db, SITE, postType, { slug: 'ep-1', title: 'Episode one & more', status: 'published', visibility: 'public', publishedAt: '2026-11-01 10:00:00', excerpt: 'We talk <bread>.', settings: { podcast: { audioUrl: '/_nuxflow/media/ep1.mp3', duration: '45:10', episode: 1, season: 2 } } })
  await seedContentItem(db, SITE, postType, { slug: 'not-an-episode', title: 'Just a post', status: 'published', visibility: 'public' })
  await seedContentItem(db, SITE, postType, { slug: 'draft-ep', title: 'Draft', status: 'draft', settings: { podcast: { audioUrl: '/_nuxflow/media/x.mp3' } } })
})
afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>
const admin = (podcast: unknown) => createMockEvent({ siteId: SITE, session: { user: { id: adminId, name: 'A', email: 'admin@pod.test' } }, body: { settings: { 'podcast.settings': podcast } } }) as unknown as H3Event
const visitor = () => createMockEvent({ siteId: SITE, headers: { host: 'pod.localhost' } }) as unknown as H3Event
const settings = { enabled: true, title: 'Bread Talk', description: 'About bread.', author: 'Sam', ownerEmail: 'sam@pod.test', coverImage: '/_nuxflow/media/cover.jpg', category: 'Leisure', explicit: false, contentType: 'post' }

describe('podcast settings', () => {
  it('needs a title to switch on, a known category and a real email', async () => {
    await expect((patchSettings as Handler)(admin({ ...settings, title: '' }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((patchSettings as Handler)(admin({ ...settings, category: 'Bread' }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((patchSettings as Handler)(admin({ ...settings, ownerEmail: 'nope' }))).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('/podcast.xml', () => {
  it('is a 404 while the podcast is off', async () => {
    await expect((feedRoute as Handler)(visitor())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lists published episodes with their audio, size, length and Apple tags', async () => {
    await (patchSettings as Handler)(admin(settings))
    const xml = await (feedRoute as Handler)(visitor()) as string
    expect(xml).toContain('<itunes:category text="Leisure" />')
    expect(xml).toContain('<itunes:email>sam@pod.test</itunes:email>')
    expect(xml).toContain('<itunes:image href="https://pod.localhost/_nuxflow/media/cover.jpg" />')
    expect(xml).toContain('<enclosure url="https://pod.localhost/_nuxflow/media/ep1.mp3" length="12345678" type="audio/mpeg" />')
    expect(xml).toContain('<itunes:duration>2710</itunes:duration>')
    expect(xml).toContain('<itunes:episode>1</itunes:episode>')
    expect(xml).toContain('<itunes:season>2</itunes:season>')
    expect(xml).toContain('<![CDATA[Episode one & more]]>')
    expect(xml).not.toContain('Just a post')
    expect(xml).not.toContain('Draft')
  })
})

describe('an episode page', () => {
  it('carries its audio for the player', async () => {
    const page = await (publicPage as Handler)(createMockEvent({ siteId: SITE, params: { slug: 'ep-1' } }) as unknown as H3Event) as { episode: { audioUrl: string; duration: string } | null }
    expect(page.episode).toMatchObject({ audioUrl: '/_nuxflow/media/ep1.mp3', duration: '45:10', episode: 1 })
  })
})

describe('parsing', () => {
  it('reads durations and refuses odd audio links', () => {
    expect(durationSeconds('45:10')).toBe(2710)
    expect(durationSeconds('1:02:03')).toBe(3723)
    expect(durationSeconds('ten minutes')).toBeNull()
    expect(parseEpisode({ podcast: { audioUrl: 'javascript:alert(1)' } })).toBeNull()
    expect(parseEpisode({ podcast: { audioUrl: 'https://cdn.test/a.mp3', duration: 'soon', episode: -1 } })).toMatchObject({ duration: '', episode: null })
  })
})
