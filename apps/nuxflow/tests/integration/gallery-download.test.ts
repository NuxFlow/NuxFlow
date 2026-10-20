/**
 * Gallery downloads (client galleries): who may download, which block, and which files —
 * only this site's library (or inline data: images), never an arbitrary pasted URL, and
 * never another site's storage key.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia } from '../helpers/seed'
import type * as CfEnv from '../../server/utils/cf-env'

const r2Objects = new Map<string, string>()
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  getCfBindings: () => ({
    r2: {
      get: async (key: string) => (r2Objects.has(key)
        ? { body: new Response(r2Objects.get(key)).body }
        : null),
    },
  }),
}))
vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
const mockSafeFetch = vi.fn()
vi.mock('../../server/utils/ssrf', () => ({
  isSafeUrl: () => true,
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

const { prepareGalleryDownload, openGalleryFile } = await import('../../server/utils/gallery-download')
const { default: downloadHandler } = await import('../../server/api/public/gallery-download.get')
const { default: patchHandler } = await import('../../server/api/v1/content/[id].patch')
const { default: unlockHandler } = await import('../../server/api/public/page-unlock.post')

const SITE = 'site-gallery-dl-01'
const OTHER = 'site-gallery-dl-02'
let editorId: string
let typeId: string

const DATA_PNG = `data:image/png;base64,${btoa('PNGBYTES')}`

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'gallery-dl.localhost' })
  await seedSite(db, { id: OTHER, domain: 'gallery-dl2.localhost' })
  editorId = await seedUser(db, { email: 'editor@gallery-dl.test' })
  await seedRole(db, editorId, SITE, 'editor')
  typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Page', singularName: 'Page' })

  await seedMedia(db, SITE, { url: 'https://cdn.example.com/site/a.jpg', originalName: 'DSC_0001.jpg', size: 10, storageProvider: 's3', storageKey: `${SITE}/a.jpg` })
  await seedMedia(db, SITE, { url: '/_nuxflow/media/' + `${SITE}/b.jpg`, originalName: 'DSC_0002.jpg', size: 10, storageProvider: 'r2', storageKey: `${SITE}/b.jpg` })
  await seedMedia(db, SITE, { url: 'https://r2.example.com/c.jpg', originalName: 'DSC_0001.jpg', size: 10, storageProvider: 'r2', storageKey: `${OTHER}/c.jpg` })
  await seedMedia(db, OTHER, { url: 'https://cdn.example.com/other/z.jpg', originalName: 'theirs.jpg', size: 10 })
  r2Objects.set(`${SITE}/b.jpg`, 'B-BYTES')
  r2Objects.set(`${OTHER}/c.jpg`, 'OTHER-SITE-BYTES')
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>
const visitor = (query: Record<string, string>, cookies: Record<string, string> = {}) =>
  createMockEvent({ siteId: SITE, query, cookies, session: null }) as unknown as H3Event

const IMAGES = [
  { url: 'https://cdn.example.com/site/a.jpg' },
  { url: `/_nuxflow/media/${SITE}/b.jpg` },
  { url: 'https://evil.example.com/not-in-library.jpg' },
  { url: 'https://cdn.example.com/other/z.jpg' },
  { url: 'https://r2.example.com/c.jpg' },
  { url: DATA_PNG },
]

async function galleryPage(slug: string, opts: { allowDownload?: boolean } = {}) {
  return seedContentItem(getCurrentTestDb(), SITE, typeId, {
    slug,
    status: 'published',
    content: { type: 'canvas', blocks: [{ id: 'gal1', type: 'canvas-gallery', props: { images: JSON.stringify(IMAGES), allowDownload: opts.allowDownload ?? true } }] },
  })
}

describe('prepareGalleryDownload', () => {
  it('serves only this site\'s library files and data: images, in gallery order, with unique names', async () => {
    await galleryPage('shoot')
    const { files, archiveName } = await prepareGalleryDownload(visitor({}), SITE, '/shoot/', 'gal1')
    expect(files.map(f => [f.url, f.name])).toEqual([
      ['https://cdn.example.com/site/a.jpg', 'DSC_0001.jpg'],
      [`/_nuxflow/media/${SITE}/b.jpg`, 'DSC_0002.jpg'],
      ['https://r2.example.com/c.jpg', 'DSC_0001 (2).jpg'],
      [DATA_PNG, 'photo-6.png'],
    ])
    expect(archiveName).toBe('shoot.zip')
  })

  it('404s when downloads are off, the block is wrong, or the page doesn\'t exist', async () => {
    await galleryPage('no-downloads', { allowDownload: false })
    await expect(prepareGalleryDownload(visitor({}), SITE, 'no-downloads', 'gal1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(prepareGalleryDownload(visitor({}), SITE, 'shoot', 'nope')).rejects.toMatchObject({ statusCode: 404 })
    await expect(prepareGalleryDownload(visitor({}), SITE, 'missing', 'gal1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('applies the page\'s password: 404 without the unlock, files with it', async () => {
    const id = await galleryPage('private-shoot')
    await (patchHandler as HandlerFn)(createMockEvent({
      siteId: SITE,
      session: { user: { id: editorId, name: 'Ed', email: 'editor@gallery-dl.test' } },
      params: { id },
      body: { settings: { access: 'password' }, pagePassword: 'client-pass' },
    }) as unknown as H3Event)

    await expect(prepareGalleryDownload(visitor({}), SITE, 'private-shoot', 'gal1')).rejects.toMatchObject({ statusCode: 404 })
    await expect((downloadHandler as HandlerFn)(visitor({ path: 'private-shoot', block: 'gal1' }))).rejects.toMatchObject({ statusCode: 404 })

    const unlock = createMockEvent({ siteId: SITE, session: null, body: { path: 'private-shoot', password: 'client-pass' } }) as unknown as H3Event
    await (unlockHandler as HandlerFn)(unlock)
    const cookies = { ...(unlock as unknown as { _cookies: Record<string, string> })._cookies }
    const { files } = await prepareGalleryDownload(visitor({}, cookies), SITE, 'private-shoot', 'gal1')
    expect(files).toHaveLength(4)
  })
})

describe('openGalleryFile', () => {
  async function read(stream: ReadableStream<Uint8Array> | null) {
    return stream ? new Response(stream).text() : null
  }

  it('reads Worker-served R2 files from the binding and decodes data: images', async () => {
    const { files } = await prepareGalleryDownload(visitor({}), SITE, 'shoot', 'gal1')
    expect(await read(await openGalleryFile(visitor({}), SITE, files[1]!))).toBe('B-BYTES')
    expect(await read(await openGalleryFile(visitor({}), SITE, files[3]!))).toBe('PNGBYTES')
  })

  it('never reads another site\'s storage key from the binding', async () => {
    mockSafeFetch.mockResolvedValueOnce(new Response('FETCHED-PUBLIC'))
    const { files } = await prepareGalleryDownload(visitor({}), SITE, 'shoot', 'gal1')
    // Row c.jpg claims storage key `${OTHER}/c.jpg`: not read from R2; its public URL is fetched instead.
    expect(await read(await openGalleryFile(visitor({}), SITE, files[2]!))).toBe('FETCHED-PUBLIC')
    expect(mockSafeFetch).toHaveBeenCalledWith('https://r2.example.com/c.jpg')
  })
})

describe('GET /api/public/gallery-download', () => {
  it('404s an out-of-range photo index and a gallery with downloads off', async () => {
    await expect((downloadHandler as HandlerFn)(visitor({ path: 'shoot', block: 'gal1', index: '99' }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((downloadHandler as HandlerFn)(visitor({ path: 'no-downloads', block: 'gal1' }))).rejects.toMatchObject({ statusCode: 404 })
  })
})
