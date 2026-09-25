/**
 * Integration tests for GET /api/v1/admin/db-export — the streaming whole-instance dump
 * (CLAUDE.md "Whole-instance D1 export"). The dump generation itself is covered by
 * tests/unit/d1-export.test.ts; this covers the route's contract around it:
 *  - super-admin only (cross-tenant data)
 *  - schema-preparation failures become a clean, labelled 500 before any bytes are sent
 *  - a complete stream ends with the "-- Exported N tables, M rows" summary
 *  - a mid-stream failure ends with "-- EXPORT FAILED" and NO summary, which is how the
 *    admin UI tells a truncated file from a complete one once the 200 is committed
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { auditLogs } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendStream: (_event: unknown, stream: ReadableStream) => stream,
}))

const { mockPrepare, mockStream } = vi.hoisted(() => ({ mockPrepare: vi.fn(), mockStream: vi.fn() }))
vi.mock('../../server/utils/d1-export', () => ({ prepareD1Dump: mockPrepare, streamD1TableData: mockStream }))

const { default: exportHandler } = await import('../../server/api/v1/admin/db-export.get')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-db-export-01'
let superId: string
let adminId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'dbx.localhost' })
  superId = await seedUser(db, { email: 'super@dbx.test' })
  adminId = await seedUser(db, { email: 'admin@dbx.test' })
  await seedRole(db, superId, SITE, 'super_admin')
  await seedRole(db, adminId, SITE, 'admin')
})
afterAll(teardownTestDb)
beforeEach(() => {
  mockPrepare.mockReset().mockResolvedValue({ headerText: 'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE t (id TEXT);\n', dataTables: [{ name: 't' }] })
  mockStream.mockReset()
})

const ev = (userId: string) =>
  createMockEvent({ siteId: SITE, session: { user: { id: userId, name: 'U', email: 'u@example.com' } } }) as unknown as H3Event

async function readAll(stream: ReadableStream<Uint8Array>) {
  return await new Response(stream).text()
}

async function latestExportAudit() {
  return getCurrentTestDb().query.auditLogs.findFirst({
    where: and(eq(auditLogs.resource, 'd1_database'), eq(auditLogs.action, 'export')),
    orderBy: [desc(auditLogs.createdAt), desc(auditLogs.id)],
  })
}

describe('GET /api/v1/admin/db-export', () => {
  it('is super-admin only', async () => {
    await expect((exportHandler as Handler)(ev(adminId))).rejects.toMatchObject({ statusCode: 403 })
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('turns a schema-preparation failure into a labelled 500 before streaming', async () => {
    mockPrepare.mockRejectedValueOnce(new Error('D1_ERROR: not authorized: SQLITE_AUTH'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = ev(superId)
    await expect((exportHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('SQLITE_AUTH') })
    expect((event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['Content-Disposition']).toBeUndefined()
    spy.mockRestore()
  })

  it('streams header + rows + completion summary as an attachment, and audits the export', async () => {
    mockStream.mockImplementation(async (_e: unknown, _tables: unknown, write: (s: string) => Promise<void>) => {
      await write('INSERT INTO "t" VALUES (\'a\');\n')
      await write('INSERT INTO "t" VALUES (\'b\');\n')
      return { tableCount: 1, rowCount: 2 }
    })
    const event = ev(superId)
    const text = await readAll(await (exportHandler as Handler)(event) as ReadableStream<Uint8Array>)

    const headers = (event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders
    expect(headers['Content-Type']).toContain('application/sql')
    expect(headers['Content-Disposition']).toMatch(/^attachment; filename="nuxflow-d1-export-\d{4}-\d{2}-\d{2}\.sql"$/)
    expect(text.startsWith('PRAGMA defer_foreign_keys=TRUE;')).toBe(true)
    expect(text).not.toMatch(/BEGIN TRANSACTION/i)
    expect(text).toContain('VALUES (\'b\')')
    expect(text.trimEnd().endsWith('-- Exported 1 table, 2 rows')).toBe(true)
    expect(text).not.toContain('EXPORT FAILED')

    // The audit write happens after the stream finishes.
    await vi.waitFor(async () => expect((await latestExportAudit())?.after).toEqual({ tableCount: 1, rowCount: 2 }))
  })

  it('marks a mid-stream failure as incomplete, omits the summary, and audits the failure', async () => {
    mockStream.mockImplementation(async (_e: unknown, _tables: unknown, write: (s: string) => Promise<void>) => {
      await write('INSERT INTO "t" VALUES (\'a\');\n')
      throw new Error('D1 DB\'s isolate exceeded its memory limit')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const text = await readAll(await (exportHandler as Handler)(ev(superId)) as ReadableStream<Uint8Array>)
    spy.mockRestore()

    expect(text).toContain('VALUES (\'a\')')
    expect(text).toContain('-- EXPORT FAILED: D1 DB\'s isolate exceeded its memory limit')
    expect(text).toContain('do not restore it')
    expect(text).not.toMatch(/-- Exported \d+ table/)
    await vi.waitFor(async () => expect((await latestExportAudit())?.after).toMatchObject({ failed: true }))
  })
})
