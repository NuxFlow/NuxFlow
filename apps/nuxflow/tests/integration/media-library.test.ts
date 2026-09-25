/**
 * Integration tests for the media library read/delete/folder routes:
 *   GET    /api/v1/media, /api/v1/media/:id
 *   DELETE /api/v1/media/:id
 *   GET    /api/v1/media/folders, POST /api/v1/media/folders
 *   GET    /api/v1/media/storage-status, /api/v1/media/video/configured
 *
 * Behaviour under test:
 *  - Reads require site membership; writes require editor.
 *  - Every lookup is site-scoped (no reading or deleting another tenant's files).
 *  - DELETE removes from the storage provider *before* the DB row, and keeps the
 *    row (502) if the provider delete fails — so a file is never orphaned in storage.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedMedia, seedMediaFolder, seedSetting } from '../helpers/seed'
import { media, auditLogs, mediaFolders } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockProvider } = vi.hoisted(() => ({
  mockProvider: { name: 'r2', delete: vi.fn(), upload: vi.fn(), getUrl: vi.fn() },
}))
vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(async () => mockProvider),
}))

const { default: listHandler } = await import('../../server/api/v1/media/index.get')
const { default: getHandler } = await import('../../server/api/v1/media/[id].get')
const { default: deleteHandler } = await import('../../server/api/v1/media/[id].delete')
const { default: foldersListHandler } = await import('../../server/api/v1/media/folders/index.get')
const { default: foldersCreateHandler } = await import('../../server/api/v1/media/folders/index.post')
const { default: storageStatusHandler } = await import('../../server/api/v1/media/storage-status.get')
const { default: videoConfiguredHandler } = await import('../../server/api/v1/media/video/configured.get')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-media-lib-01'
const OTHER = 'site-media-lib-02'
let editorId: string
let authorId: string
let viewerId: string
let strangerId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'ml.localhost' })
  await seedSite(db, { id: OTHER, domain: 'ml2.localhost' })
  editorId = await seedUser(db, { email: 'editor@ml.test' })
  authorId = await seedUser(db, { email: 'author@ml.test' })
  viewerId = await seedUser(db, { email: 'viewer@ml.test' })
  strangerId = await seedUser(db, { email: 'stranger@ml.test' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, viewerId, SITE, 'viewer')
})

afterAll(teardownTestDb)
beforeEach(() => {
  mockProvider.delete.mockReset().mockResolvedValue(undefined)
  mockProvider.name = 'r2'
})

function ev(userId: string, opts: { siteId?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    body: opts.body,
    params: opts.params,
    query: opts.query,
  }) as unknown as H3Event
}

describe('GET /api/v1/media', () => {
  let folderId: string

  beforeAll(async () => {
    const db = getCurrentTestDb()
    folderId = await seedMediaFolder(db, SITE, { name: 'Photos' })
    await seedMedia(db, SITE, { folderId, originalName: 'in-folder.jpg' })
    await seedMedia(db, SITE, { originalName: 'loose.jpg' })
    await seedMedia(db, OTHER, { originalName: 'foreign.jpg' })
  })

  it('rejects a user with no role on this site', async () => {
    await expect((listHandler as Handler)(ev(strangerId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists only this site\'s files', async () => {
    const res = await (listHandler as Handler)(ev(viewerId)) as { files: { originalName: string }[]; total: number }
    const names = res.files.map(f => f.originalName)
    expect(names).toEqual(expect.arrayContaining(['in-folder.jpg', 'loose.jpg']))
    expect(names).not.toContain('foreign.jpg')
    expect(res.total).toBe(res.files.length)
  })

  it('filters by folder, and by "no folder" via folderId=null', async () => {
    const inFolder = await (listHandler as Handler)(ev(viewerId, { query: { folderId } })) as { files: { originalName: string }[] }
    expect(inFolder.files.map(f => f.originalName)).toEqual(['in-folder.jpg'])

    const loose = await (listHandler as Handler)(ev(viewerId, { query: { folderId: 'null' } })) as { files: { originalName: string }[] }
    expect(loose.files.map(f => f.originalName)).toContain('loose.jpg')
    expect(loose.files.map(f => f.originalName)).not.toContain('in-folder.jpg')
  })

  it('paginates', async () => {
    const res = await (listHandler as Handler)(ev(viewerId, { query: { limit: '1', page: '2' } })) as { files: unknown[]; page: number; limit: number; total: number }
    expect(res.files).toHaveLength(1)
    expect(res.page).toBe(2)
    expect(res.limit).toBe(1)
    expect(res.total).toBeGreaterThanOrEqual(2)
  })
})

describe('GET /api/v1/media/:id', () => {
  it('returns a file on this site and 404s for another site\'s file', async () => {
    const db = getCurrentTestDb()
    const mine = await seedMedia(db, SITE)
    const theirs = await seedMedia(db, OTHER)
    expect(await (getHandler as Handler)(ev(viewerId, { params: { id: mine } }))).toMatchObject({ id: mine })
    await expect((getHandler as Handler)(ev(viewerId, { params: { id: theirs } }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /api/v1/media/:id', () => {
  it('forbids an author', async () => {
    const db = getCurrentTestDb()
    const id = await seedMedia(db, SITE)
    await expect((deleteHandler as Handler)(ev(authorId, { params: { id } }))).rejects.toMatchObject({ statusCode: 403 })
    expect(mockProvider.delete).not.toHaveBeenCalled()
  })

  it('deletes from storage, then the row, and audits', async () => {
    const db = getCurrentTestDb()
    const id = await seedMedia(db, SITE, { storageKey: 'site/abc.jpg' })
    const event = ev(editorId, { params: { id } })
    await (deleteHandler as Handler)(event)

    expect(mockProvider.delete).toHaveBeenCalledWith('site/abc.jpg')
    expect((event as unknown as { _status: number })._status).toBe(204)
    expect(await db.query.media.findFirst({ where: eq(media.id, id) })).toBeUndefined()
    const log = await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.resource, 'media'), eq(auditLogs.resourceId, id)) })
    expect(log?.before).toMatchObject({ storageKey: 'site/abc.jpg' })
  })

  it('keeps the DB row and returns 502 when the storage delete fails', async () => {
    const db = getCurrentTestDb()
    const id = await seedMedia(db, SITE)
    mockProvider.delete.mockRejectedValueOnce(new Error('R2 unavailable'))
    await expect((deleteHandler as Handler)(ev(editorId, { params: { id } }))).rejects.toMatchObject({ statusCode: 502 })
    expect(await db.query.media.findFirst({ where: eq(media.id, id) })).toBeDefined()
  })

  it('404s for another site\'s file without touching storage', async () => {
    const db = getCurrentTestDb()
    const theirs = await seedMedia(db, OTHER)
    await expect((deleteHandler as Handler)(ev(editorId, { params: { id: theirs } }))).rejects.toMatchObject({ statusCode: 404 })
    expect(mockProvider.delete).not.toHaveBeenCalled()
    expect(await db.query.media.findFirst({ where: eq(media.id, theirs) })).toBeDefined()
  })
})

describe('media folders', () => {
  it('creates a folder (editor+) with a trimmed name', async () => {
    const event = ev(editorId, { body: { name: '  Brand assets  ' } })
    const res = await (foldersCreateHandler as Handler)(event) as { id: string; name: string }
    expect(res.name).toBe('Brand assets')
    expect((event as unknown as { _status: number })._status).toBe(201)
    const db = getCurrentTestDb()
    const row = await db.query.mediaFolders.findFirst({ where: eq(mediaFolders.id, res.id) })
    expect(row?.siteId).toBe(SITE)
  })

  it('forbids an author creating folders and rejects an empty name', async () => {
    await expect((foldersCreateHandler as Handler)(ev(authorId, { body: { name: 'x' } }))).rejects.toMatchObject({ statusCode: 403 })
    await expect((foldersCreateHandler as Handler)(ev(editorId, { body: { name: '   ' } }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('lists this site\'s folders sorted by name with per-folder and unfoldered file counts', async () => {
    const db = getCurrentTestDb()
    const zeta = await seedMediaFolder(db, SITE, { name: 'Zeta' })
    await seedMedia(db, SITE, { folderId: zeta })
    await seedMedia(db, SITE, { folderId: zeta })
    await seedMediaFolder(db, OTHER, { name: 'Foreign' })

    const res = await (foldersListHandler as Handler)(ev(viewerId)) as { folders: { name: string; fileCount: number }[]; unfolderedCount: number }
    const names = res.folders.map(f => f.name)
    expect(names).toEqual([...names].sort())
    expect(names).not.toContain('Foreign')
    expect(res.folders.find(f => f.name === 'Zeta')?.fileCount).toBe(2)
    expect(res.unfolderedCount).toBeGreaterThan(0)
  })
})

describe('GET /api/v1/media/storage-status', () => {
  it('reports the active provider and whether it is the database fallback', async () => {
    expect(await (storageStatusHandler as Handler)(ev(viewerId))).toEqual({ provider: 'r2', isFallback: false })
    mockProvider.name = 'local'
    expect(await (storageStatusHandler as Handler)(ev(viewerId))).toEqual({ provider: 'local', isFallback: true })
  })
})

describe('GET /api/v1/media/video/configured', () => {
  it('requires author+', async () => {
    await expect((videoConfiguredHandler as Handler)(ev(viewerId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('is true only when both account id and stream token are set', async () => {
    expect(await (videoConfiguredHandler as Handler)(ev(authorId))).toEqual({ configured: false })
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'cloudflare.account_id', 'acct123')
    expect(await (videoConfiguredHandler as Handler)(ev(authorId))).toEqual({ configured: false })
  })
})
