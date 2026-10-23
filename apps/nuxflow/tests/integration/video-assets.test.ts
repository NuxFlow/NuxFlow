import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedVideoAsset } from '../helpers/seed'
import { auditLogs, videoAssets } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import listHandler from '../../server/api/v1/media/video/index.get'
import registerHandler from '../../server/api/v1/media/video/index.post'
import getHandler from '../../server/api/v1/media/video/[id].get'
import patchHandler from '../../server/api/v1/media/video/[id].patch'
import deleteHandler from '../../server/api/v1/media/video/[id].delete'
import tokenHandler from '../../server/api/v1/media/video/token.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-video-01'
let viewerUserId: string
let authorUserId: string
let editorUserId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'video.localhost' })

  viewerUserId = await seedUser(db, { email: 'viewer@video.test' })
  authorUserId = await seedUser(db, { email: 'author@video.test' })
  editorUserId = await seedUser(db, { email: 'editor@video.test' })

  await seedRole(db, viewerUserId, SITE, 'viewer')
  await seedRole(db, authorUserId, SITE, 'author')
  await seedRole(db, editorUserId, SITE, 'editor')
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(overrides: {
  userId?: string
  params?: Record<string, string>
  body?: unknown
  noSession?: boolean
} = {}) {
  const { userId = editorUserId, params = {}, body, noSession = false } = overrides
  const user = noSession ? null : { id: userId, name: 'Test User', email: 'test@video.test' }
  return createMockEvent({
    siteId: SITE,
    session: user ? { user } : null,
    params,
    body,
  }) as unknown as H3Event
}

// ---------------------------------------------------------------------------
// GET /api/v1/media/video — list
// ---------------------------------------------------------------------------

describe('GET /api/v1/media/video', () => {
  it('returns 401 when not authenticated', async () => {
    await expect(
      (listHandler as HandlerFn)(mkEvent({ noSession: true })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns empty array when no videos exist for site', async () => {
    const otherSiteId = 'site-video-empty'
    await seedSite(getCurrentTestDb(), { id: otherSiteId, domain: 'empty-video.localhost' })
    const otherUserId = await seedUser(getCurrentTestDb(), { email: 'other@video.test' })
    await seedRole(getCurrentTestDb(), otherUserId, otherSiteId, 'viewer')

    const event = createMockEvent({
      siteId: otherSiteId,
      session: { user: { id: otherUserId, name: 'Other', email: 'other@video.test' } },
    }) as unknown as H3Event

    const result = await (listHandler as HandlerFn)(event)
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(0)
  })

  it('returns video assets belonging to the site', async () => {
    const db = getCurrentTestDb()
    await seedVideoAsset(db, SITE, { title: 'Intro Video', status: 'ready' })
    await seedVideoAsset(db, SITE, { title: 'Demo Video', status: 'processing' })

    const result = await (listHandler as HandlerFn)(mkEvent({ userId: viewerUserId })) as {
      id: string
      title: string
      status: string
    }[]

    expect(Array.isArray(result)).toBe(true)
    const titles = result.map(v => v.title)
    expect(titles).toContain('Intro Video')
    expect(titles).toContain('Demo Video')
  })

  it('returns videos in descending creation order', async () => {
    const result = await (listHandler as HandlerFn)(mkEvent({ userId: viewerUserId })) as {
      createdAt: string
    }[]

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.createdAt >= result[i]!.createdAt).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/media/video — register
// ---------------------------------------------------------------------------

describe('POST /api/v1/media/video', () => {
  it('returns 401 when not authenticated', async () => {
    await expect(
      (registerHandler as HandlerFn)(mkEvent({ noSession: true, body: { uid: 'abc123' } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 403 when user is viewer (needs author+)', async () => {
    await expect(
      (registerHandler as HandlerFn)(mkEvent({ userId: viewerUserId, body: { uid: 'abc123' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 422 when uid is missing', async () => {
    await expect(
      (registerHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: {} })),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns 501 when Cloudflare Stream is not configured', async () => {
    const uid = 'deadbeef1234567890abcdef12345678'
    await expect(
      (registerHandler as HandlerFn)(
        mkEvent({ userId: authorUserId, body: { uid, title: 'New Upload' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 501 })
  })

  it('does not insert a stuck video_assets row when the CF Stream lookup returns non-ok', async () => {
    const uid = 'badbad001234567890abcdef12345678'
    const originalConfig = globalThis.useRuntimeConfig

    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-reg-fail',
      cloudflareStreamToken: 'tok-reg-fail',
    })

    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' })
    vi.stubGlobal('fetch', mockFetch)

    try {
      await expect(
        (registerHandler as HandlerFn)(
          mkEvent({ userId: authorUserId, body: { uid } }),
        ),
      ).rejects.toMatchObject({ statusCode: 404 })

      const result = await (listHandler as HandlerFn)(mkEvent({ userId: viewerUserId })) as { cloudflareStreamId: string }[]
      expect(result.some(v => v.cloudflareStreamId === uid)).toBe(false)
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('returns 422 for a uid that is not a Stream UID (e.g. a path traversal attempt)', async () => {
    await expect(
      (registerHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: { uid: '../../zones' } })),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects registration when the upload uid belongs to a different site (cross-tenant IDOR)', async () => {
    // token.post.ts stamps meta.siteId with the site that requested the upload URL — a
    // shared Cloudflare account across tenants (the default unless a site overrides
    // cloudflare.account_id/stream_token) means the `uid` itself is otherwise entirely
    // client-supplied with no proof it was issued to this site's upload flow.
    const uid = 'a0e70031234567890abcdef12345678f'
    const originalConfig = globalThis.useRuntimeConfig

    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-cross-tenant',
      cloudflareStreamToken: 'tok-cross-tenant',
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          duration: 30,
          status: { state: 'ready' },
          meta: { name: 'Belongs To Another Site', siteId: 'some-other-site' },
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    try {
      await expect(
        (registerHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: { uid } })),
      ).rejects.toMatchObject({ statusCode: 403 })

      const result = await (listHandler as HandlerFn)(mkEvent({ userId: viewerUserId })) as { cloudflareStreamId: string }[]
      expect(result.some(v => v.cloudflareStreamId === uid)).toBe(false)
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('returns 502 when the CF Stream lookup response is unsuccessful during registration', async () => {
    const uid = 'badbad021234567890abcdef12345678'
    const originalConfig = globalThis.useRuntimeConfig

    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-reg-fail-2',
      cloudflareStreamToken: 'tok-reg-fail-2',
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    })
    vi.stubGlobal('fetch', mockFetch)

    try {
      await expect(
        (registerHandler as HandlerFn)(
          mkEvent({ userId: authorUserId, body: { uid } }),
        ),
      ).rejects.toMatchObject({ statusCode: 502 })
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('uses Untitled Video as fallback title when none provided and CF is configured', async () => {
    const uid = 'cafebabe1234567890abcdef12345678'
    const originalConfig = globalThis.useRuntimeConfig

    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-fallback',
      cloudflareStreamToken: 'tok-fallback',
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          duration: 10,
          status: { state: 'ready' },
          meta: { siteId: SITE },
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    try {
      const result = await (registerHandler as HandlerFn)(
        mkEvent({ userId: authorUserId, body: { uid } }),
      ) as { title: string }

      expect(result.title).toBe('Untitled Video')
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('creates a video asset with CF-provided metadata when CF is configured', async () => {
    const uid = 'feedface1234567890abcdef12345678'
    const originalConfig = globalThis.useRuntimeConfig

    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-123',
      cloudflareStreamToken: 'tok-abc',
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          duration: 120,
          thumbnail: 'https://thumb.example.com/vid.jpg',
          status: { state: 'ready' },
          meta: { name: 'CF Title', siteId: SITE },
        },
      }),
    })

    vi.stubGlobal('fetch', mockFetch)

    try {
      const result = await (registerHandler as HandlerFn)(
        mkEvent({ userId: authorUserId, body: { uid, size: 1024000 } }),
      ) as { title: string; status: string }

      expect(result.title).toBe('CF Title')
      expect(result.status).toBe('ready')
      expect(mockFetch).toHaveBeenCalledOnce()
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/media/video/:id — get by id
// ---------------------------------------------------------------------------

describe('GET /api/v1/media/video/:id', () => {
  let videoId: string

  beforeEach(async () => {
    videoId = await seedVideoAsset(getCurrentTestDb(), SITE, {
      title: 'Detail Test',
      status: 'ready',
      cloudflareStreamId: 'aabbccdd1234567890abcdef12345678',
    })
  })

  it('returns 401 when not authenticated', async () => {
    await expect(
      (getHandler as HandlerFn)(mkEvent({ noSession: true, params: { id: videoId } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 404 for a non-existent video id', async () => {
    await expect(
      (getHandler as HandlerFn)(mkEvent({ params: { id: 'does-not-exist' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns the video asset for a valid id', async () => {
    const result = await (getHandler as HandlerFn)(
      mkEvent({ userId: viewerUserId, params: { id: videoId } }),
    ) as { id: string; title: string; status: string }

    expect(result.id).toBe(videoId)
    expect(result.title).toBe('Detail Test')
    expect(result.status).toBe('ready')
  })

  it('syncs status from Cloudflare when video is still processing', async () => {
    const processingId = await seedVideoAsset(getCurrentTestDb(), SITE, {
      title: 'Processing Video',
      status: 'processing',
      cloudflareStreamId: '11223344556677889900aabbccddeeff',
    })

    const originalConfig = globalThis.useRuntimeConfig
    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-456',
      cloudflareStreamToken: 'tok-xyz',
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          duration: 240,
          thumbnail: 'https://thumb.example.com/proc.jpg',
          status: { state: 'ready' },
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    try {
      const result = await (getHandler as HandlerFn)(
        mkEvent({ userId: viewerUserId, params: { id: processingId } }),
      ) as { status: string; duration: number }

      expect(result.status).toBe('ready')
      expect(result.duration).toBe(240)
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('does not call Cloudflare when video is already ready', async () => {
    const originalConfig = globalThis.useRuntimeConfig
    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-check',
      cloudflareStreamToken: 'tok-check',
    })

    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    try {
      await (getHandler as HandlerFn)(mkEvent({ params: { id: videoId } }))
      expect(mockFetch).not.toHaveBeenCalled()
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/media/video/:id — update title
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/media/video/:id', () => {
  let videoId: string

  beforeEach(async () => {
    videoId = await seedVideoAsset(getCurrentTestDb(), SITE, { title: 'Original Title' })
  })

  it('returns 401 when not authenticated', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkEvent({ noSession: true, params: { id: videoId }, body: { title: 'New' } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 403 when user is author (needs editor+)', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkEvent({ userId: authorUserId, params: { id: videoId }, body: { title: 'New' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 for a non-existent video id', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkEvent({ params: { id: 'nope' }, body: { title: 'X' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 422 when title is empty', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkEvent({ params: { id: videoId }, body: { title: '' } })),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns 422 when title is whitespace only', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkEvent({ params: { id: videoId }, body: { title: '   ' } })),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('updates the title and returns success', async () => {
    const result = await (patchHandler as HandlerFn)(
      mkEvent({ params: { id: videoId }, body: { title: 'Updated Title' } }),
    ) as { success: boolean }

    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/media/video/:id — delete
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/media/video/:id', () => {
  it('returns 401 when not authenticated', async () => {
    const id = await seedVideoAsset(getCurrentTestDb(), SITE, { title: 'Del Unauth' })
    await expect(
      (deleteHandler as HandlerFn)(mkEvent({ noSession: true, params: { id } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 403 when user is author (needs editor+)', async () => {
    const id = await seedVideoAsset(getCurrentTestDb(), SITE, { title: 'Del Author' })
    await expect(
      (deleteHandler as HandlerFn)(mkEvent({ userId: authorUserId, params: { id } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 for a non-existent video id', async () => {
    await expect(
      (deleteHandler as HandlerFn)(mkEvent({ params: { id: 'ghost' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('deletes the video from DB without CF config, recording the Stream video left behind', async () => {
    const id = await seedVideoAsset(getCurrentTestDb(), SITE, { title: 'To Delete' })
    const result = await (deleteHandler as HandlerFn)(
      mkEvent({ params: { id } }),
    )

    expect(result).toBeNull()

    // Confirm it's gone
    await expect(
      (getHandler as HandlerFn)(mkEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 404 })

    const log = await getCurrentTestDb().query.auditLogs.findFirst({
      where: and(eq(auditLogs.siteId, SITE), eq(auditLogs.resource, 'video_assets'), eq(auditLogs.resourceId, id)),
    })
    expect(log?.before).toMatchObject({ orphanedOn: 'stream' })
  })

  async function withStreamConfig(mockFetch: ReturnType<typeof vi.fn>, fn: () => Promise<void>) {
    const originalConfig = globalThis.useRuntimeConfig
    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-del',
      cloudflareStreamToken: 'tok-del',
    })
    vi.stubGlobal('fetch', mockFetch)
    try {
      await fn()
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  }

  it('keeps the row and returns 502 when Cloudflare Stream refuses the delete', async () => {
    const id = await seedVideoAsset(getCurrentTestDb(), SITE, {
      title: 'CF Fail Delete',
      cloudflareStreamId: 'ffffffffffffffffffffffffffffffff',
    })
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'CF Error' })

    await withStreamConfig(mockFetch, async () => {
      await expect(
        (deleteHandler as HandlerFn)(mkEvent({ params: { id } })),
      ).rejects.toMatchObject({ statusCode: 502 })
    })

    const row = await getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.id, id) })
    expect(row).toBeDefined()
  })

  it('keeps the row and returns 502 when Cloudflare Stream is unreachable', async () => {
    const id = await seedVideoAsset(getCurrentTestDb(), SITE, {
      title: 'CF Down Delete',
      cloudflareStreamId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    })
    const mockFetch = vi.fn().mockRejectedValue(new Error('network down'))

    await withStreamConfig(mockFetch, async () => {
      await expect(
        (deleteHandler as HandlerFn)(mkEvent({ params: { id } })),
      ).rejects.toMatchObject({ statusCode: 502 })
    })

    const row = await getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.id, id) })
    expect(row).toBeDefined()
  })

  it('deletes the row when Stream says the video is already gone (404)', async () => {
    const id = await seedVideoAsset(getCurrentTestDb(), SITE, {
      title: 'CF Gone Delete',
      cloudflareStreamId: 'dddddddddddddddddddddddddddddddd',
    })
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' })

    await withStreamConfig(mockFetch, async () => {
      const result = await (deleteHandler as HandlerFn)(mkEvent({ params: { id } }))
      expect(result).toBeNull()
    })

    const row = await getCurrentTestDb().query.videoAssets.findFirst({ where: eq(videoAssets.id, id) })
    expect(row).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/media/video/token — get upload token
// ---------------------------------------------------------------------------

describe('POST /api/v1/media/video/token', () => {
  it('returns 401 when not authenticated', async () => {
    await expect(
      (tokenHandler as HandlerFn)(mkEvent({ noSession: true })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 403 when user is viewer (needs author+)', async () => {
    await expect(
      (tokenHandler as HandlerFn)(mkEvent({ userId: viewerUserId })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 422 without the file size', async () => {
    await expect(
      (tokenHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: { title: 'x.mp4' } })),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns 501 when Cloudflare Stream is not configured', async () => {
    await expect(
      (tokenHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: { size: 1000 } })),
    ).rejects.toMatchObject({ statusCode: 501 })
  })

  it('starts a resumable upload and lists the video as uploading', async () => {
    const originalConfig = globalThis.useRuntimeConfig
    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-token',
      cloudflareStreamToken: 'tok-token',
    })

    const uid = 'aabbccddee1234567890abcdef123456'
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 201,
      headers: { Location: `https://upload.cloudflarestream.com/${uid}?tusv2=true`, 'stream-media-id': uid },
    }))
    vi.stubGlobal('fetch', mockFetch)

    try {
      const result = await (tokenHandler as HandlerFn)(
        mkEvent({ userId: authorUserId, body: { title: 'My Upload.mp4', size: 300_000_000 } }),
      ) as { uploadUrl: string; uid: string; id: string }

      expect(result.uploadUrl).toBe(`https://upload.cloudflarestream.com/${uid}?tusv2=true`)
      expect(result.uid).toBe(uid)
      const [url, init] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct-token/stream?direct_user=true')
      expect(new Headers(init.headers).get('tus-resumable')).toBe('1.0.0')

      const db = getCurrentTestDb()
      const [row] = await db.select().from(videoAssets).where(eq(videoAssets.id, result.id))
      expect(row).toMatchObject({ siteId: SITE, cloudflareStreamId: uid, status: 'uploading', title: 'My Upload', size: 300_000_000, streamAccount: 'site' })
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('returns 402 when the Stream account has no minutes, and writes no row', async () => {
    const originalConfig = globalThis.useRuntimeConfig
    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-none',
      cloudflareStreamToken: 'tok-none',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, errors: [{ code: 10011, message: 'Insufficient minutes' }] }), { status: 403 })))

    try {
      const db = getCurrentTestDb()
      const before = (await db.select().from(videoAssets).where(eq(videoAssets.siteId, SITE))).length
      await expect(
        (tokenHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: { size: 1000 } })),
      ).rejects.toMatchObject({ statusCode: 402 })
      expect((await db.select().from(videoAssets).where(eq(videoAssets.siteId, SITE))).length).toBe(before)
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })

  it('returns 502 when CF API returns a non-ok response', async () => {
    const originalConfig = globalThis.useRuntimeConfig
    globalThis.useRuntimeConfig = () => ({
      ...originalConfig(),
      cloudflareAccountId: 'acct-fail',
      cloudflareStreamToken: 'tok-fail',
    })

    const mockFetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', mockFetch)

    try {
      await expect(
        (tokenHandler as HandlerFn)(mkEvent({ userId: authorUserId, body: { size: 1000 } })),
      ).rejects.toMatchObject({ statusCode: 502 })
    } finally {
      globalThis.useRuntimeConfig = originalConfig
      vi.unstubAllGlobals()
    }
  })
})
