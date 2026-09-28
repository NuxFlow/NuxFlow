import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'
import { auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: getHandler } = await import('../../server/api/v1/site-checklist.get')
const { default: patchHandler } = await import('../../server/api/v1/site-checklist.patch')
const { clearSeoSettingsCache } = await import('../../server/utils/seo')

type Handler = (e: H3Event) => Promise<unknown>
interface Res {
  items: { id: string; tier: string; status: string; skipped: boolean }[]
  summary: { essentialOpen: number; problems: number }
  hidden: boolean
}

const SITE = 'site-checklist-01'
let adminId: string
let editorId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'checklist.localhost' })
  adminId = await seedUser(db, { email: 'admin@checklist.test', name: 'Admin' })
  editorId = await seedUser(db, { email: 'editor@checklist.test', name: 'Editor' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
})

afterAll(teardownTestDb)

const asAdmin = (body?: unknown) => createMockEvent({ siteId: SITE, body, method: body ? 'PATCH' : 'GET', session: { user: { id: adminId, name: 'Admin', email: 'admin@checklist.test' } } }) as unknown as H3Event
const item = (res: Res, id: string) => res.items.find(i => i.id === id)!

describe('GET /api/v1/site-checklist', () => {
  it('reports a fresh install\'s gaps: database storage, no email, no SEO basics', async () => {
    const res = await (getHandler as Handler)(asAdmin()) as Res
    expect(item(res, 'storage').status).toBe('todo')
    expect(item(res, 'email').status).toBe('todo')
    expect(item(res, 'seo').status).toBe('todo')
    expect(item(res, 'backup').status).toBe('todo')
    expect(res.summary.essentialOpen).toBeGreaterThan(0)
    expect(res.hidden).toBe(false)
  })

  it('ticks items off from real site state', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'seo.description', 'A description')
    await seedSetting(db, SITE, 'seo.og_image', '/og.png')
    clearSeoSettingsCache(SITE)
    await db.insert(auditLogs).values({ id: ulid(), siteId: SITE, userId: adminId, action: 'export', resource: 'site', resourceId: SITE })

    const res = await (getHandler as Handler)(asAdmin()) as Res
    expect(item(res, 'seo').status).toBe('done')
    expect(item(res, 'backup').status).toBe('done')
  })

  it('is admin-only', async () => {
    const ev = createMockEvent({ siteId: SITE, session: { user: { id: editorId, name: 'Editor', email: 'editor@checklist.test' } } }) as unknown as H3Event
    await expect((getHandler as Handler)(ev)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('PATCH /api/v1/site-checklist', () => {
  it('skips and un-skips recommended items', async () => {
    await (patchHandler as Handler)(asAdmin({ skip: 'indexnow' }))
    let res = await (getHandler as Handler)(asAdmin()) as Res
    expect(item(res, 'indexnow').skipped).toBe(true)

    await (patchHandler as Handler)(asAdmin({ unskip: 'indexnow' }))
    res = await (getHandler as Handler)(asAdmin()) as Res
    expect(item(res, 'indexnow').skipped).toBe(false)
  })

  it('refuses to skip an essential item', async () => {
    await expect((patchHandler as Handler)(asAdmin({ skip: 'email' }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((patchHandler as Handler)(asAdmin({ skip: 'nonsense' }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('refuses to hide the card while essential steps are open', async () => {
    await expect((patchHandler as Handler)(asAdmin({ hidden: true }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('ignores a stored "hidden" flag while essential steps are open', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'dashboard.checklist_hidden', true as unknown as string)
    const res = await (getHandler as Handler)(asAdmin()) as Res
    expect(res.summary.essentialOpen).toBeGreaterThan(0)
    expect(res.hidden).toBe(false)
  })
})
