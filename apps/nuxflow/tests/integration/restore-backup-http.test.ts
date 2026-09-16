/**
 * Integration tests for the actual HTTP handlers behind backup/restore:
 *   GET  /api/v1/backup   — server/api/v1/backup.get.ts
 *   POST /api/v1/restore  — server/api/v1/restore.post.ts
 *
 * backup-restore.test.ts already thoroughly covers buildBackup()/applyBackup() (the
 * core export/import logic) directly. This file covers what that one deliberately
 * doesn't: the HTTP layer wrapped around them — multipart form parsing, zip
 * creation/extraction via fflate, validateZipArchive()'s Zip Slip/Zip Bomb checks, and
 * parseBackupJson()'s Zod validation of an uploaded backup.json — by calling the real
 * route handlers instead of the underlying functions.
 *
 * This became possible once readMultipartFormData()/readFormData() were stubbed in
 * tests/helpers/globals.ts (backed by `_multipartFormData`/`_formData` on the mock
 * event, the same pattern as `_body`/`_query`) — previously the missing gap that made
 * HTTP-layer testing impractical here.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { zipSync, unzipSync } from 'fflate'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems, menus, users } from '@nuxflow/db/schema'
import { eq, and } from 'drizzle-orm'
import backupGetHandler from '../../server/api/v1/backup.get'
import restorePostHandler from '../../server/api/v1/restore.post'
import type { NuxFlowBackup } from '../../server/utils/backup'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const BACKUP_SITE = 'site-http-backup-01'
const RESTORE_ZIP_SITE = 'site-http-restore-zip-01'
const RESTORE_JSON_SITE = 'site-http-restore-json-01'
const VALIDATION_SITE = 'site-http-restore-validate-01'

let adminId: string
let viewerId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

function admin(userId: string) {
  return { user: { id: userId, name: 'Admin', email: 'admin@http-backup.test' } }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: BACKUP_SITE, domain: 'http-backup.localhost' })
  await seedSite(db, { id: RESTORE_ZIP_SITE, domain: 'http-restore-zip.localhost' })
  await seedSite(db, { id: RESTORE_JSON_SITE, domain: 'http-restore-json.localhost' })
  await seedSite(db, { id: VALIDATION_SITE, domain: 'http-restore-validate.localhost' })

  adminId = await seedUser(db, { email: 'admin@http-backup.test' })
  viewerId = await seedUser(db, { email: 'viewer@http-backup.test' })
  for (const site of [BACKUP_SITE, RESTORE_ZIP_SITE, RESTORE_JSON_SITE, VALIDATION_SITE]) {
    await seedRole(db, adminId, site, 'admin')
  }
  await seedRole(db, viewerId, BACKUP_SITE, 'viewer')

  const typeId = await seedContentType(db, BACKUP_SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  await seedContentItem(db, BACKUP_SITE, typeId, {
    slug: 'hello-http',
    title: 'Hello HTTP',
    status: 'published',
    excerpt: 'An excerpt',
  })
})

afterAll(teardownTestDb)

// A minimal-but-schema-valid NuxFlowBackup, built by hand rather than via buildBackup()
// so these HTTP-layer tests don't depend on KV/plugin-signing/better-auth mocks that
// backup-restore.test.ts needs only because it exercises themes/plugins/users — none of
// which the restore route's own multipart/zip/validation plumbing cares about.
function minimalBackup(overrides: Partial<NuxFlowBackup> = {}): NuxFlowBackup {
  return {
    version: '1',
    exportedAt: new Date().toISOString(),
    site: { name: 'Restored Site', locale: 'en', timezone: 'UTC' },
    settings: { 'seo.meta_title': 'Restored Title' },
    contentTypes: [{
      slug: 'post', name: 'Posts', singularName: 'Post',
      icon: null, isBuiltIn: false, hasRevisions: false, hasComments: false,
    }],
    content: [{
      typeSlug: 'post', slug: 'restored-post', title: 'Restored Post',
      status: 'published', visibility: 'public',
      content: { type: 'doc', content: [] },
      excerpt: null, seoTitle: null, seoDescription: null, ogImage: null,
      publishedAt: null, settings: null, termSlugs: [], locale: null, sourceItemSlug: null,
    }],
    taxonomies: [],
    menus: [{ name: 'Main Menu', location: 'header', items: [{ label: 'Home', url: '/' }] }],
    forms: [],
    media: [],
    themes: [],
    plugins: [],
    users: [],
    membershipTiers: [],
    ...overrides,
  }
}

function zipOf(backup: unknown, extraEntries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    ...extraEntries,
    'backup.json': new TextEncoder().encode(JSON.stringify(backup)),
  }, { level: 1 })
}

function mkRestoreEvent(siteId: string, fileData: Uint8Array, userId = adminId, query?: Record<string, string>) {
  return createMockEvent({
    siteId,
    session: { user: { id: userId, name: 'Admin', email: 'admin@http-backup.test' } },
    query,
    multipartFormData: [{ name: 'file', filename: 'backup.zip', type: 'application/octet-stream', data: fileData }],
  }) as unknown as H3Event
}

describe('GET /api/v1/backup (real HTTP handler)', () => {
  it('produces a real, unzippable zip containing backup.json with the site\'s content', async () => {
    const event = createMockEvent({
      siteId: BACKUP_SITE,
      session: admin(adminId),
    }) as unknown as H3Event

    const zipBytes = await (backupGetHandler as HandlerFn)(event) as Uint8Array
    expect(zipBytes[0]).toBe(0x50)
    expect(zipBytes[1]).toBe(0x4B)

    const files = unzipSync(zipBytes)
    expect(files['backup.json']).toBeTruthy()
    const backup = JSON.parse(new TextDecoder().decode(files['backup.json'])) as NuxFlowBackup
    expect(backup.content.some(c => c.slug === 'hello-http')).toBe(true)

    expect((event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['Content-Type']).toBe('application/zip')
    expect((event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['Content-Disposition']).toMatch(/attachment/)
  })

  it('rejects a non-admin (viewer) with 403', async () => {
    const event = createMockEvent({
      siteId: BACKUP_SITE,
      session: { user: { id: viewerId, name: 'Viewer', email: 'viewer@http-backup.test' } },
    }) as unknown as H3Event

    await expect((backupGetHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('POST /api/v1/restore (real HTTP handler)', () => {
  it('(a) restores successfully from a real zip upload, through multipart + unzip + Zod validation', async () => {
    const backup = minimalBackup()
    const zipBytes = zipOf(backup)
    const event = mkRestoreEvent(RESTORE_ZIP_SITE, zipBytes)

    const result = await (restorePostHandler as HandlerFn)(event) as {
      success: boolean
      result: { content: { created: number }; menus: { created: number }; settings: { updated: number } }
      media: { uploaded: number; skipped: number }
    }

    expect(result.success).toBe(true)
    expect(result.result.content.created).toBe(1)
    expect(result.result.menus.created).toBe(1)
    expect(result.result.settings.updated).toBe(1)
    expect(result.media).toEqual({ uploaded: 0, skipped: 0 })

    const db = getCurrentTestDb()
    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, RESTORE_ZIP_SITE), eq(contentItems.slug, 'restored-post')),
    })
    expect(item).toBeTruthy()
    expect(item!.title).toBe('Restored Post')

    const menu = await db.query.menus.findFirst({
      where: and(eq(menus.siteId, RESTORE_ZIP_SITE), eq(menus.name, 'Main Menu')),
    })
    expect(menu).toBeTruthy()
  })

  it('(b) rejects a zip containing a Zip-Slip path-traversal entry before ever unzipping it', async () => {
    const backup = minimalBackup()
    const zipBytes = zipOf(backup, { '../../evil.txt': new TextEncoder().encode('pwned') })
    const event = mkRestoreEvent(VALIDATION_SITE, zipBytes)

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/traversal/i),
    })

    // No content should have been created — the archive was rejected before restore ran.
    const db = getCurrentTestDb()
    const items = await db.query.contentItems.findMany({ where: eq(contentItems.siteId, VALIDATION_SITE) })
    expect(items).toHaveLength(0)
  })

  it('(c) restores successfully from a raw .json upload (content-only, no bundled media)', async () => {
    const backup = minimalBackup({
      content: [{
        ...minimalBackup().content[0],
        slug: 'restored-post-json',
      }],
    })
    const rawJson = new TextEncoder().encode(JSON.stringify(backup))
    const event = mkRestoreEvent(RESTORE_JSON_SITE, rawJson)

    const result = await (restorePostHandler as HandlerFn)(event) as {
      success: boolean
      result: { content: { created: number } }
      media: { uploaded: number; skipped: number }
    }

    expect(result.success).toBe(true)
    expect(result.result.content.created).toBe(1)
    expect(result.media).toEqual({ uploaded: 0, skipped: 0 })

    const db = getCurrentTestDb()
    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, RESTORE_JSON_SITE), eq(contentItems.slug, 'restored-post-json')),
    })
    expect(item).toBeTruthy()
  })

  it('(d) rejects a malformed backup.json with a clear 400 via parseBackupJson()\'s Zod validation', async () => {
    const malformed = { foo: 'bar', notARealBackup: true }
    const rawJson = new TextEncoder().encode(JSON.stringify(malformed))
    const event = mkRestoreEvent(VALIDATION_SITE, rawJson)

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/validation/i),
    })
  })

  it('(d.2) rejects backup.json that isn\'t even valid JSON', async () => {
    const rawJson = new TextEncoder().encode('{ not valid json ][')
    const event = mkRestoreEvent(VALIDATION_SITE, rawJson)

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/not valid json/i),
    })
  })

  it('(e) rejects a hand-crafted backup.json granting super_admin at the HTTP layer, not just the underlying function', async () => {
    const backup = minimalBackup({
      users: [{ email: 'attacker@http-backup.test', name: 'Attacker', role: 'super_admin' } as unknown as NuxFlowBackup['users'][number]],
    })
    const rawJson = new TextEncoder().encode(JSON.stringify(backup))
    const event = mkRestoreEvent(VALIDATION_SITE, rawJson, adminId, { what: 'content,users' })

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/validation/i),
    })

    // Confirm the attacker's account was never even provisioned — the request never
    // got past parseBackupJson(), so applyBackup()'s users loop never ran at all.
    const db = getCurrentTestDb()
    const attacker = await db.query.users.findFirst({
      where: eq(users.email, 'attacker@http-backup.test'),
    })
    expect(attacker).toBeFalsy()
  })

  it('rejects an upload over the 100 MB limit with 413, without reading its contents', async () => {
    // A real 101 MB buffer would make this test slow and memory-heavy for no benefit —
    // the route's own check (`file.data.byteLength > MAX_UPLOAD_BYTES`) only ever reads
    // .byteLength, so a plain object satisfying just that field exercises the same guard.
    const fakeOversizedFile = { byteLength: 101 * 1024 * 1024 } as unknown as Uint8Array
    const event = createMockEvent({
      siteId: VALIDATION_SITE,
      session: admin(adminId),
      multipartFormData: [{ name: 'file', filename: 'backup.zip', data: fakeOversizedFile }],
    }) as unknown as H3Event

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 413 })
  })

  it('rejects when no file is uploaded at all', async () => {
    const event = createMockEvent({
      siteId: VALIDATION_SITE,
      session: admin(adminId),
      multipartFormData: [],
    }) as unknown as H3Event

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a non-admin (viewer) before even reading the upload', async () => {
    const backup = minimalBackup()
    const event = mkRestoreEvent(BACKUP_SITE, zipOf(backup), viewerId)

    await expect((restorePostHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
