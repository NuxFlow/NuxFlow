/**
 * Video for creators: hosted customers uploading into the platform's Stream account
 * (within their plan's video minutes), resumable uploads registered as soon as they start,
 * private videos (signed links, auto-private on password pages), and what search engines
 * are told about a page's videos.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { hostingPlans, notifications, sites, siteSettings, siteUsageDaily, videoAssets } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedVideoAsset, seedSetting } from '../helpers/seed'
import { base64ToBytes, bytesToBase64 } from '../../shared/lib/base64'
import type * as CfEnv from '../../server/utils/cf-env'

const kvStore = new Map<string, string>()
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  getCfBindings: () => ({
    kv: {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => { kvStore.set(key, value) },
      delete: async (key: string) => { kvStore.delete(key) },
    },
    loader: null,
    r2: null,
  }),
  waitUntil: (_e: unknown, p: Promise<unknown>) => { void p },
}))
vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const { default: tokenHandler } = await import('../../server/api/v1/media/video/token.post')
const { default: registerHandler } = await import('../../server/api/v1/media/video/index.post')
const { default: configuredHandler } = await import('../../server/api/v1/media/video/configured.get')
const { default: listHandler } = await import('../../server/api/v1/media/video/index.get')
const { default: videoPatchHandler } = await import('../../server/api/v1/media/video/[id].patch')
const { default: playbackHandler } = await import('../../server/api/public/video-playback.get')
const { default: contentPatchHandler } = await import('../../server/api/v1/content/[id].patch')
const { clearHostingPlanCache, planUsage } = await import('../../server/utils/hosting-plans')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { clearSiteInfoCache } = await import('../../server/utils/site-info')
const { markPrivateVideos } = await import('../../server/utils/stream')
const { describePageVideos } = await import('../../server/utils/video-seo')
const { syncVideoWatchUsage } = await import('../../server/utils/video-usage')

type Handler = (e: H3Event) => Promise<unknown>

const PRIMARY = 'site-video-platform-primary'
const TENANT = 'site-video-platform-tenant'
const OWN = 'site-video-platform-own'
let authorId: string
let editorId: string
let ownAuthorId: string
let typeId: string

const user = (id: string) => ({ user: { id, name: 'U', email: `${id}@video.test` } })
const ev = (opts: Parameters<typeof createMockEvent>[0] = {}) => createMockEvent({ siteId: TENANT, ...opts }) as unknown as H3Event

const UID = (n: number) => n.toString(16).padStart(32, 'a')
const CUSTOMER_THUMB = (uid: string) => `https://customer-abc123.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`

// ── A fake Cloudflare Stream API ──────────────────────────────────────────────
let keyPair: CryptoKeyPair
let keyRequests = 0
const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = []
const streamVideos = new Map<string, { duration?: number; thumbnail?: string; creator?: string; state?: string; requireSignedURLs?: boolean }>()
let nextUploadUid = UID(100)

// Minutes watched per video uid today, as Stream's analytics report them.
const minutesViewedToday = new Map<string, number>()

async function fakeStream(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
  calls.push({ method, url, headers, body })
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  if (url.endsWith('/client/v4/graphql')) {
    const { start, after } = (body as { variables: { start: string; after: string } }).variables
    const rows = start === new Date().toISOString().slice(0, 10) && after === ''
      ? [...minutesViewedToday].map(([uid, minutesViewed]) => ({ sum: { minutesViewed }, dimensions: { uid } }))
      : []
    return json({ data: { viewer: { accounts: [{ streamMinutesViewedAdaptiveGroups: rows }] } }, errors: null })
  }

  if (url.includes('vimeo.com/api/oembed.json')) {
    return json({ thumbnail_url: 'https://i.vimeocdn.com/video/1.jpg', duration: 95, upload_date: '2025-01-02 10:00:00', title: 'Our Film' })
  }
  const m = /\/stream(\/[^?]*)?(?:\?.*)?$/.exec(url)
  const path = m?.[1] ?? ''
  if (method === 'POST' && path === '' && url.includes('direct_user=true')) {
    const uid = nextUploadUid
    streamVideos.set(uid, { creator: headers['upload-creator'], state: 'pendingupload' })
    return new Response(null, { status: 201, headers: { Location: `https://upload.cloudflarestream.com/${uid}?tusv2=true`, 'stream-media-id': uid } })
  }
  if (method === 'POST' && path === '/keys') {
    keyRequests++
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
    return json({ success: true, result: { id: 'key-1', jwk: bytesToBase64(new TextEncoder().encode(JSON.stringify(jwk))) } })
  }
  const uid = path.slice(1)
  const video = streamVideos.get(uid)
  if (!video) return json({ success: false, errors: [{ code: 10005, message: 'Not found' }] }, 404)
  if (method === 'GET') {
    return json({ success: true, result: { uid, duration: video.duration ?? -1, thumbnail: video.thumbnail, creator: video.creator, status: { state: video.state ?? 'ready' }, requireSignedURLs: video.requireSignedURLs ?? false } })
  }
  if (method === 'POST') {
    video.requireSignedURLs = (body as { requireSignedURLs?: boolean }).requireSignedURLs
    return json({ success: true, result: { uid } })
  }
  if (method === 'DELETE') {
    streamVideos.delete(uid)
    return new Response(null, { status: 200 })
  }
  return json({ success: false }, 400)
}

const originalConfig = globalThis.useRuntimeConfig

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair

  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.video.test', isPrimary: true })
  await seedSite(db, { id: TENANT, domain: 'tenant.video.test' })
  await seedSite(db, { id: OWN, domain: 'own.video.test' })
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  // OWN brings its own Stream account (Settings → Media).
  await seedSetting(db, OWN, 'cloudflare.account_id', 'own-account')
  await seedSetting(db, OWN, 'cloudflare.stream_token', 'own-token')

  authorId = await seedUser(db, { email: 'author@video-platform.test' })
  editorId = await seedUser(db, { email: 'editor@video-platform.test' })
  ownAuthorId = await seedUser(db, { email: 'own@video-platform.test' })
  await seedRole(db, authorId, TENANT, 'author')
  await seedRole(db, editorId, TENANT, 'editor')
  await seedRole(db, ownAuthorId, OWN, 'author')
  typeId = await seedContentType(db, TENANT, { slug: 'page', name: 'Page', singularName: 'Page' })
})

afterAll(teardownTestDb)

beforeEach(() => {
  // The platform's Stream account comes from the deployment's env vars (the primary site's
  // fallback), which a hosted customer never gets directly.
  globalThis.useRuntimeConfig = () => ({ ...originalConfig(), cloudflareAccountId: 'platform-account', cloudflareStreamToken: 'platform-token' })
  vi.stubGlobal('fetch', vi.fn(fakeStream))
  calls.length = 0
  clearHostingPlanCache()
  clearHostingPlatformCache()
  clearSiteInfoCache()
})

afterEach(() => {
  globalThis.useRuntimeConfig = originalConfig
  vi.unstubAllGlobals()
})

async function usePlan(maxVideoMinutes: number | null) {
  const db = getCurrentTestDb()
  const id = ulid()
  await db.insert(hostingPlans).values({ id, name: `Plan ${id.slice(-4)}`, maxVideoMinutes })
  await db.update(sites).set({ hostingPlanId: id }).where(eq(sites.id, TENANT))
  clearHostingPlanCache()
}

function decodeMetadata(header: string): Record<string, string> {
  return Object.fromEntries(header.split(',').map((pair) => {
    const [k, v] = pair.split(' ')
    return [k!, v ? new TextDecoder().decode(base64ToBytes(v)) : '']
  }))
}

describe('hosted customers and the platform Stream account', () => {
  it('a plan without video minutes can\'t upload, and says why', async () => {
    await usePlan(0)
    expect(await (configuredHandler as Handler)(ev({ session: user(authorId) }))).toMatchObject({ configured: false, account: 'platform' })
    await expect((tokenHandler as Handler)(ev({ session: user(authorId), body: { title: 'a.mp4', size: 1000 } })))
      .rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit', limit: 'video' } })
    expect(calls).toHaveLength(0)
  })

  it('uploads into the platform account, capped at the minutes left, and lists the video straight away', async () => {
    await usePlan(30)
    const db = getCurrentTestDb()
    // 10 minutes already used (601 s rounds up to 11; 539 s to 9).
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: UID(1), duration: 601, streamAccount: 'platform' })
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: UID(2), duration: 539, streamAccount: 'platform' })
    // Videos in a site's own account never count.
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: UID(3), duration: 3600, streamAccount: 'site' })
    expect(await planUsage(db, TENANT, 'video')).toBe(20)
    expect(await (configuredHandler as Handler)(ev({ session: user(authorId) }))).toMatchObject({ configured: true, account: 'platform', minutesLeft: 10 })

    nextUploadUid = UID(10)
    const result = await (tokenHandler as Handler)(ev({ session: user(authorId), body: { title: 'Smith wedding.mp4', size: 5_000_000_000 } })) as { uploadUrl: string; uid: string; id: string }
    expect(result.uploadUrl).toBe(`https://upload.cloudflarestream.com/${UID(10)}?tusv2=true`)
    expect(result.uid).toBe(UID(10))

    const create = calls.find(c => c.url.includes('direct_user=true'))!
    expect(create.url).toContain('/accounts/platform-account/stream')
    expect(create.headers.authorization).toBe('Bearer platform-token')
    expect(create.headers['upload-length']).toBe('5000000000')
    expect(create.headers['upload-creator']).toBe(TENANT)
    expect(decodeMetadata(create.headers['upload-metadata']!)).toEqual({ name: 'Smith wedding', maxDurationSeconds: '600' })

    const row = await db.query.videoAssets.findFirst({ where: eq(videoAssets.id, result.id) })
    expect(row).toMatchObject({ siteId: TENANT, cloudflareStreamId: UID(10), status: 'uploading', streamAccount: 'platform', title: 'Smith wedding' })
  })

  it('finishing an upload brings the existing row up to date', async () => {
    streamVideos.set(UID(10), { creator: TENANT, duration: 312.4, thumbnail: CUSTOMER_THUMB(UID(10)), state: 'ready' })
    const result = await (registerHandler as Handler)(ev({ session: user(authorId), body: { uid: UID(10), size: 5_000_000_000 } })) as { status: string }
    expect(result.status).toBe('ready')
    const rows = await getCurrentTestDb().select().from(videoAssets).where(and(eq(videoAssets.siteId, TENANT), eq(videoAssets.cloudflareStreamId, UID(10))))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'ready', duration: 312, thumbnailUrl: CUSTOMER_THUMB(UID(10)) })
    expect(calls.every(c => c.url.includes('/accounts/platform-account/'))).toBe(true)
  })

  it('a site with its own Stream account uses it, with no plan limit', async () => {
    nextUploadUid = UID(20)
    await (tokenHandler as Handler)(createMockEvent({ siteId: OWN, session: user(ownAuthorId), body: { title: 'reel.mov', size: 1000 } }) as unknown as H3Event)
    const create = calls.find(c => c.url.includes('direct_user=true'))!
    expect(create.url).toContain('/accounts/own-account/stream')
    expect(decodeMetadata(create.headers['upload-metadata']!).maxDurationSeconds).toBe(String(4 * 60 * 60))
    const row = await getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.cloudflareStreamId, UID(20)) })
    expect(row?.streamAccount).toBe('site')
  })

  it('refuses to register an upload stamped with another site', async () => {
    streamVideos.set(UID(30), { creator: OWN, state: 'ready' })
    await expect((registerHandler as Handler)(ev({ session: user(authorId), body: { uid: UID(30) } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('private videos', () => {
  const PRIVATE_UID = UID(40)
  const PUBLIC_UID = UID(41)
  let privateVideoId: string

  beforeAll(async () => {
    const db = getCurrentTestDb()
    privateVideoId = await seedVideoAsset(db, TENANT, { cloudflareStreamId: PRIVATE_UID, streamAccount: 'platform', thumbnailUrl: CUSTOMER_THUMB(PRIVATE_UID) })
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: PUBLIC_UID, streamAccount: 'platform' })
    streamVideos.set(PRIVATE_UID, { state: 'ready' })
    streamVideos.set(PUBLIC_UID, { state: 'ready' })
  })

  const canvas = (uid: string, blockId = 'vid1') => ({ type: 'canvas', blocks: [{ id: 'cols', type: 'canvas-columns', props: {}, children: { col1: [{ id: blockId, type: 'canvas-video', props: { url: `https://iframe.videodelivery.net/${uid}` } }] } }] })

  it('saving a password-protected page makes its library videos private on Stream', async () => {
    const pageId = await seedContentItem(getCurrentTestDb(), TENANT, typeId, { slug: 'smith-film', content: canvas(PRIVATE_UID) })
    await (contentPatchHandler as Handler)(ev({ session: user(editorId), params: { id: pageId }, body: { settings: { access: 'password' }, pagePassword: 'client-pass' } }))

    const privacy = calls.find(c => c.method === 'POST' && c.url.endsWith(`/stream/${PRIVATE_UID}`))
    expect(privacy?.body).toMatchObject({ requireSignedURLs: true })
    const row = await getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.id, privateVideoId) })
    expect(row?.isPrivate).toBe(true)
  })

  it('a public page leaves its videos alone', async () => {
    const pageId = await seedContentItem(getCurrentTestDb(), TENANT, typeId, { slug: 'showreel', content: canvas(PUBLIC_UID, 'reel') })
    await (contentPatchHandler as Handler)(ev({ session: user(editorId), params: { id: pageId }, body: { title: 'Showreel' } }))
    expect(calls.some(c => c.method === 'POST' && c.url.endsWith(`/stream/${PUBLIC_UID}`))).toBe(false)
  })

  it('marks each Stream block on the page as private or public', async () => {
    const content = { type: 'canvas', blocks: [...canvas(PRIVATE_UID).blocks, { id: 'v2', type: 'canvas-video', props: { url: PUBLIC_UID } }] }
    const marked = await markPrivateVideos(getCurrentTestDb(), TENANT, content) as typeof content
    expect((marked.blocks[0] as { children: { col1: Array<{ props: { privateVideo?: boolean } }> } }).children.col1[0]!.props.privateVideo).toBe(true)
    expect((marked.blocks[1] as { props: { privateVideo?: boolean } }).props.privateVideo).toBe(false)
    // Never written back into the stored content.
    expect((content.blocks[1] as { props: Record<string, unknown> }).props.privateVideo).toBeUndefined()
  })

  async function verifyToken(url: string) {
    const m = /^https:\/\/customer-abc123\.cloudflarestream\.com\/([\w-]+)\.([\w-]+)\.([\w-]+)\/iframe\?/.exec(url)
    expect(m).not.toBeNull()
    const [, header, payload, signature] = m!
    const fromB64Url = (s: string) => base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/'))
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keyPair.publicKey, fromB64Url(signature!), new TextEncoder().encode(`${header}.${payload}`))
    expect(ok).toBe(true)
    return {
      header: JSON.parse(new TextDecoder().decode(fromB64Url(header!))),
      payload: JSON.parse(new TextDecoder().decode(fromB64Url(payload!))),
    }
  }

  it('a visitor who can see the page gets a signed link; one who can\'t gets a 404', async () => {
    const visitor = (query: Record<string, string>, cookies: Record<string, string> = {}) => ev({ session: null, query, cookies })
    // The page is password protected and not unlocked.
    await expect((playbackHandler as Handler)(visitor({ video: PRIVATE_UID, path: 'smith-film', block: 'vid1' }))).rejects.toMatchObject({ statusCode: 404 })

    // On a public page that shows it, the video plays.
    await seedContentItem(getCurrentTestDb(), TENANT, typeId, { slug: 'trailer', content: canvas(PRIVATE_UID, 'trail') })
    const { url } = await (playbackHandler as Handler)(visitor({ video: PRIVATE_UID, path: 'trailer', block: 'trail' })) as { url: string }
    const { header, payload } = await verifyToken(url)
    expect(header).toEqual({ alg: 'RS256', kid: 'key-1' })
    expect(payload.sub).toBe(PRIVATE_UID)
    expect(payload.exp - payload.nbf).toBeGreaterThan(60 * 60)

    // The block must really be on that page, showing that video.
    await expect((playbackHandler as Handler)(visitor({ video: PRIVATE_UID, path: 'showreel', block: 'reel' }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((playbackHandler as Handler)(visitor({ video: PRIVATE_UID, path: 'trailer' }))).rejects.toMatchObject({ statusCode: 404 })
    // A public video needs no signed link.
    expect(await (playbackHandler as Handler)(visitor({ video: PUBLIC_UID, path: 'showreel', block: 'reel' }))).toEqual({ url: null })
    // Another site's video is never signed.
    await expect((playbackHandler as Handler)(createMockEvent({ siteId: OWN, session: null, query: { video: PRIVATE_UID, path: 'trailer', block: 'trail' } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 404 })
    // The signing key was created once and kept (encrypted) in KV.
    expect(keyRequests).toBe(1)
    expect([...kvStore.keys()].filter(k => k.startsWith('stream-key:'))).toEqual(['stream-key:platform:platform-account'])
    expect(kvStore.get('stream-key:platform:platform-account')).not.toContain('"d"')
  })

  it('signed-in team members can watch any of the site\'s private videos (the editor)', async () => {
    const { url } = await (playbackHandler as Handler)(ev({ session: user(editorId), query: { video: PRIVATE_UID } })) as { url: string }
    expect((await verifyToken(url)).payload.sub).toBe(PRIVATE_UID)
  })

  it('the library lists private videos with signed player and thumbnail links', async () => {
    const list = await (listHandler as Handler)(ev({ session: user(editorId) })) as Array<{ cloudflareStreamId: string; playbackUrl: string; thumbnailUrl: string | null }>
    const priv = list.find(v => v.cloudflareStreamId === PRIVATE_UID)!
    await verifyToken(priv.playbackUrl)
    expect(priv.thumbnailUrl).toMatch(/^https:\/\/customer-abc123\.cloudflarestream\.com\/[\w-]+\.[\w-]+\.[\w-]+\/thumbnails\/thumbnail\.jpg$/)
    const pub = list.find(v => v.cloudflareStreamId === PUBLIC_UID)!
    expect(pub.playbackUrl).toBe(`https://iframe.videodelivery.net/${PUBLIC_UID}?controls=true`)
  })

  it('an editor can switch a video back to public', async () => {
    calls.length = 0
    await (videoPatchHandler as Handler)(ev({ session: user(editorId), params: { id: privateVideoId }, body: { isPrivate: false } }))
    expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({ requireSignedURLs: false })
    const row = await getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.id, privateVideoId) })
    expect(row?.isPrivate).toBe(false)
  })
})

describe('what search engines are told', () => {
  it('describes each public video, with block, library, Vimeo and page fallbacks', async () => {
    const db = getCurrentTestDb()
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: UID(50), title: 'Library title', duration: 200, thumbnailUrl: CUSTOMER_THUMB(UID(50)), createdAt: '2026-01-05 09:00:00' })
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: UID(51), isPrivate: true })
    const content = {
      type: 'canvas',
      blocks: [
        { id: 'a', type: 'canvas-video', props: { url: 'https://youtube.com/shorts/dQw4w9WgXcQ', title: 'Behind the scenes', description: 'How we shot it.' } },
        { id: 'b', type: 'canvas-video', props: { url: 'https://vimeo.com/76979871/8272103f6e' } },
        { id: 'c', type: 'canvas-video', props: { url: UID(50) } },
        { id: 'd', type: 'canvas-video', props: { url: UID(51) } },
        { id: 'e', type: 'canvas-video', props: { url: 'https://youtu.be/dQw4w9WgXcQ' } },
        { id: 'f', type: 'canvas-video', props: { url: 'https://example.com/not-a-video' } },
      ],
    }
    const videos = await describePageVideos(db, TENANT, content, { title: 'Films', description: 'Wedding films.', publishedAt: '2026-02-01T12:00:00.000Z' })
    expect(videos).toEqual([
      {
        name: 'Behind the scenes', description: 'How we shot it.',
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
        watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        uploadDate: '2026-02-01T12:00:00.000Z', duration: undefined, durationSeconds: undefined,
      },
      {
        name: 'Our Film', description: 'Wedding films.',
        thumbnailUrl: 'https://i.vimeocdn.com/video/1.jpg',
        embedUrl: 'https://player.vimeo.com/video/76979871?h=8272103f6e&dnt=1',
        watchUrl: 'https://vimeo.com/76979871/8272103f6e',
        uploadDate: '2025-01-02T10:00:00.000Z', duration: 'PT1M35S', durationSeconds: 95,
      },
      {
        name: 'Library title', description: 'Wedding films.',
        thumbnailUrl: CUSTOMER_THUMB(UID(50)),
        embedUrl: `https://iframe.videodelivery.net/${UID(50)}?controls=true`,
        watchUrl: `https://iframe.videodelivery.net/${UID(50)}`,
        uploadDate: '2026-01-05T09:00:00.000Z', duration: 'PT3M20S', durationSeconds: 200,
      },
    ])
  })
})

describe('the plan\'s video minutes watched a month', () => {
  const WATCH_SITE = 'site-video-platform-watch'
  const PUBLIC_VID = UID(60)
  const PRIVATE_VID = UID(61)
  let planId: string
  let adminId: string

  const eventFor = (siteId: string) => createMockEvent({ siteId }) as unknown as H3Event
  const run = () => syncVideoWatchUsage(getCurrentTestDb(), eventFor)
  const row = (uid: string) => getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.cloudflareStreamId, uid) })
  const notices = () => getCurrentTestDb().select().from(notifications)
    .where(and(eq(notifications.siteId, WATCH_SITE), eq(notifications.type, 'system.plan_limit')))
  // This site's videos only: the other test sites' plans allow 0 minutes watched, so their
  // platform videos get paused by the same runs.
  const streamPosts = () => calls
    .filter(c => c.method === 'POST' && [PUBLIC_VID, PRIVATE_VID].some(uid => c.url.endsWith(`/stream/${uid}`)))
    .map(c => [c.url.split('/').pop(), c.body])

  beforeAll(async () => {
    const db = getCurrentTestDb()
    await seedSite(db, { id: WATCH_SITE, domain: 'watch.video.test' })
    adminId = await seedUser(db, { email: 'admin@video-watch.test' })
    await seedRole(db, adminId, WATCH_SITE, 'admin')
    const watchTypeId = await seedContentType(db, WATCH_SITE, { slug: 'page', name: 'Page', singularName: 'Page' })
    planId = ulid()
    await db.insert(hostingPlans).values({ id: planId, name: 'Video 100', maxVideoMinutes: 1000, maxVideoMinutesWatchedPerMonth: 100 })
    await db.update(sites).set({ hostingPlanId: planId }).where(eq(sites.id, WATCH_SITE))
    // The analytics API token the operator set on Super Admin → Platform.
    await seedSetting(db, PRIMARY, 'analytics.cf_api_token', 'analytics-token')
    await seedVideoAsset(db, WATCH_SITE, { cloudflareStreamId: PUBLIC_VID, streamAccount: 'platform' })
    await seedVideoAsset(db, WATCH_SITE, { cloudflareStreamId: PRIVATE_VID, streamAccount: 'platform', isPrivate: true })
    streamVideos.set(PUBLIC_VID, { state: 'ready' })
    streamVideos.set(PRIVATE_VID, { state: 'ready', requireSignedURLs: true })
    await seedContentItem(db, WATCH_SITE, watchTypeId, { slug: 'reel', content: { type: 'canvas', blocks: [{ id: 'r', type: 'canvas-video', props: { url: PUBLIC_VID } }] } })
  })

  it('counts minutes watched from Stream\'s analytics, per site', async () => {
    minutesViewedToday.set(PUBLIC_VID, 40.2)
    minutesViewedToday.set(PRIVATE_VID, 10)
    const result = await run()
    expect(result.counted).toBe(true)
    const graphql = calls.find(c => c.url.endsWith('/graphql'))!
    expect(graphql.headers.authorization).toBe('Bearer analytics-token')
    expect((graphql.body as { variables: { accountTag: string } }).variables.accountTag).toBe('platform-account')
    const [usage] = await getCurrentTestDb().select().from(siteUsageDaily)
      .where(and(eq(siteUsageDaily.siteId, WATCH_SITE), eq(siteUsageDaily.metric, 'video_minutes_viewed')))
    expect(usage?.value).toBe(51)
    expect(await planUsage(getCurrentTestDb(), WATCH_SITE, 'video_watch')).toBe(51)
    expect((await row(PUBLIC_VID))?.watchPaused).toBe(false)

    // A second run the same hour replaces the day's total rather than adding to it.
    await run()
    expect(await planUsage(getCurrentTestDb(), WATCH_SITE, 'video_watch')).toBe(51)
  })

  it('at the limit, pauses the site\'s videos, tells its admins, and refuses visitors a link', async () => {
    minutesViewedToday.set(PUBLIC_VID, 95)
    calls.length = 0
    const result = await run()
    expect(result.paused).toBe(2)
    // Only the public one needed Stream changing; the private one already needs signed links.
    expect(streamPosts()).toEqual([[PUBLIC_VID, { uid: PUBLIC_VID, requireSignedURLs: true }]])
    expect((await row(PUBLIC_VID))?.watchPaused).toBe(true)
    expect((await row(PRIVATE_VID))?.watchPaused).toBe(true)
    expect(await notices()).toHaveLength(1)

    // The page now marks the video as needing a signed link…
    const marked = await markPrivateVideos(getCurrentTestDb(), WATCH_SITE, { type: 'canvas', blocks: [{ id: 'r', type: 'canvas-video', props: { url: PUBLIC_VID } as Record<string, unknown> }] })
    expect(marked.blocks[0]!.props).toMatchObject({ privateVideo: true })
    // …which visitors don't get, while the team can still preview it.
    await expect((playbackHandler as Handler)(createMockEvent({ siteId: WATCH_SITE, session: null, query: { video: PUBLIC_VID, path: 'reel', block: 'r' } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit', limit: 'video_watch' } })
    const staff = await (playbackHandler as Handler)(createMockEvent({ siteId: WATCH_SITE, session: user(adminId), query: { video: PUBLIC_VID } }) as unknown as H3Event) as { url: string }
    expect(staff.url).toMatch(/^https:\/\/iframe\.videodelivery\.net\//)

    // Told once a month, not every hour.
    await run()
    expect(await notices()).toHaveLength(1)
  })

  it('plays them again once the allowance has room (a bigger plan, or the 1st)', async () => {
    await getCurrentTestDb().update(hostingPlans).set({ maxVideoMinutesWatchedPerMonth: 500 }).where(eq(hostingPlans.id, planId))
    clearHostingPlanCache()
    calls.length = 0
    const result = await run()
    expect(result.resumed).toBe(2)
    expect(streamPosts()).toEqual([[PUBLIC_VID, { uid: PUBLIC_VID, requireSignedURLs: false }]])
    expect((await row(PUBLIC_VID))?.watchPaused).toBe(false)
    // The private video stays private.
    expect(await row(PRIVATE_VID)).toMatchObject({ watchPaused: false, isPrivate: true })
  })

  it('without the analytics token nothing is counted, and says so', async () => {
    await getCurrentTestDb().delete(siteSettings).where(and(eq(siteSettings.siteId, PRIMARY), eq(siteSettings.key, 'analytics.cf_api_token')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    calls.length = 0
    const result = await run()
    expect(result.counted).toBe(false)
    expect(calls.some(c => c.url.endsWith('/graphql'))).toBe(false)
    expect(warn.mock.calls.some(([m]) => String(m).includes('analytics API token'))).toBe(true)
    warn.mockRestore()
  })
})

describe('private videos in posts and Video galleries', () => {
  const POST_VID = UID(70)
  const GALLERY_VID = UID(71)

  beforeAll(async () => {
    const db = getCurrentTestDb()
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: POST_VID, streamAccount: 'platform', isPrivate: true })
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: GALLERY_VID, streamAccount: 'platform', isPrivate: true })
    await seedContentItem(db, TENANT, typeId, { slug: 'film-post', content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'video', attrs: { url: POST_VID } }] } })
    await seedContentItem(db, TENANT, typeId, { slug: 'films', content: { type: 'canvas', blocks: [{ id: 'gal', type: 'canvas-video-gallery', props: { videos: `https://youtu.be/dQw4w9WgXcQ | Trailer\n${GALLERY_VID} | Full film` } }] } })
  })

  const visitor = (query: Record<string, string>) => ev({ session: null, query })

  it('a visitor to the post gets a signed link for its video', async () => {
    const { url } = await (playbackHandler as Handler)(visitor({ video: POST_VID, path: 'film-post' })) as { url: string }
    expect(url).toMatch(/^https:\/\/iframe\.videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\?/)
    // Not for a video the post doesn't show.
    await expect((playbackHandler as Handler)(visitor({ video: GALLERY_VID, path: 'film-post' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('a visitor to the gallery gets a signed link for one of its videos', async () => {
    const { url } = await (playbackHandler as Handler)(visitor({ video: GALLERY_VID, path: 'films', block: 'gal' })) as { url: string }
    expect(url).toMatch(/^https:\/\/iframe\.videodelivery\.net\//)
    await expect((playbackHandler as Handler)(visitor({ video: POST_VID, path: 'films', block: 'gal' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('a gallery and a post mark their private videos for the browser', async () => {
    const gallery = await markPrivateVideos(getCurrentTestDb(), TENANT, { type: 'canvas', blocks: [{ id: 'gal', type: 'canvas-video-gallery', props: { videos: `https://youtu.be/dQw4w9WgXcQ\n${GALLERY_VID}` } as Record<string, unknown> }] })
    expect(gallery.blocks[0]!.props.privateVideos).toEqual([GALLERY_VID])
    const post = await markPrivateVideos(getCurrentTestDb(), TENANT, { type: 'doc', content: [{ type: 'video', attrs: { url: POST_VID } as Record<string, unknown> }] })
    expect(post.content[0]!.attrs.privateVideo).toBe(true)
  })

  it('saving a password-protected post makes its videos private', async () => {
    const db = getCurrentTestDb()
    const uid = UID(72)
    await seedVideoAsset(db, TENANT, { cloudflareStreamId: uid, streamAccount: 'platform' })
    streamVideos.set(uid, { state: 'ready' })
    const id = await seedContentItem(db, TENANT, typeId, { slug: 'client-post', content: { type: 'doc', content: [{ type: 'video', attrs: { url: `https://iframe.videodelivery.net/${uid}` } }] } })
    await (contentPatchHandler as Handler)(ev({ session: user(editorId), params: { id }, body: { settings: { access: 'password' }, pagePassword: 'client-pass' } }))
    expect((await db.query.videoAssets.findFirst({ where: eq(videoAssets.cloudflareStreamId, uid) }))?.isPrivate).toBe(true)
  })
})
