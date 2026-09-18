import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { redirects, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: listHandler } = await import('../../server/api/v1/redirects/index.get')
const { default: createHandler } = await import('../../server/api/v1/redirects/index.post')
const { default: deleteHandler } = await import('../../server/api/v1/redirects/[id].delete')

const SITE = 'site-redirects-01'
const OTHER_SITE = 'site-redirects-02'

let editorId: string
let authorId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'redirects.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'redirects2.localhost' })

  editorId = await seedUser(db, { email: 'editor@redirects.test', name: 'Editor' })
  authorId = await seedUser(db, { email: 'author@redirects.test', name: 'Author' })

  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function editorEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@redirects.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

function authorEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@redirects.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

describe('GET /api/v1/redirects', () => {
  it('throws 403 for author (below editor)', async () => {
    await expect((listHandler as Handler)(authorEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists redirects scoped to the current site', async () => {
    const db = getCurrentTestDb()
    const id = ulid()
    await db.insert(redirects).values({ id, siteId: SITE, from: '/old-path', to: '/new-path', statusCode: 301 })
    await db.insert(redirects).values({ id: ulid(), siteId: OTHER_SITE, from: '/foreign', to: '/other', statusCode: 301 })

    const result = await (listHandler as Handler)(editorEvent()) as { redirects: { id: string; from: string }[] }
    expect(result.redirects.some(r => r.id === id)).toBe(true)
    expect(result.redirects.some(r => r.from === '/foreign')).toBe(false)
  })
})

describe('POST /api/v1/redirects', () => {
  it('creates a redirect and writes an audit log', async () => {
    const event = editorEvent({ body: { from: '/legacy', to: '/modern', statusCode: 301 } })
    const result = await (createHandler as Handler)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.redirects.findFirst({ where: eq(redirects.id, result.id) })
    expect(row?.from).toBe('/legacy')
    expect(row?.to).toBe('/modern')

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'redirect'), eq(auditLogs.resourceId, result.id)),
    })
    expect(log?.action).toBe('create')
  })

  it('defaults statusCode to 301 when not provided', async () => {
    const event = editorEvent({ body: { from: '/no-status', to: '/target' } })
    const result = await (createHandler as Handler)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.redirects.findFirst({ where: eq(redirects.id, result.id) })
    expect(row?.statusCode).toBe(301)
  })

  it('rejects a "from" path that does not start with a slash', async () => {
    const event = editorEvent({ body: { from: 'no-leading-slash', to: '/target' } })
    await expect((createHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects an invalid statusCode', async () => {
    const event = editorEvent({ body: { from: '/x', to: '/y', statusCode: 404 } })
    await expect((createHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 403 for author (below editor)', async () => {
    await expect(
      (createHandler as Handler)(authorEvent({ body: { from: '/a', to: '/b' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('DELETE /api/v1/redirects/:id', () => {
  it('deletes a redirect', async () => {
    const db = getCurrentTestDb()
    const id = ulid()
    await db.insert(redirects).values({ id, siteId: SITE, from: '/gone', to: '/somewhere', statusCode: 302 })

    await (deleteHandler as Handler)(editorEvent({ params: { id } }))

    const row = await db.query.redirects.findFirst({ where: eq(redirects.id, id) })
    expect(row).toBeUndefined()
  })

  it('throws 404 for a redirect belonging to another site', async () => {
    const db = getCurrentTestDb()
    const id = ulid()
    await db.insert(redirects).values({ id, siteId: OTHER_SITE, from: '/foreign-del', to: '/x', statusCode: 301 })

    await expect(
      (deleteHandler as Handler)(editorEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
