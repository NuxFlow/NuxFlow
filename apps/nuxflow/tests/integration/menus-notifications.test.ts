/**
 * Integration tests for menu read/update/delete behaviour (the role floor itself is
 * covered by menus-permissions.test.ts), in-app notifications, and the
 * sendNotification() helper that feeds them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { menus, notifications } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockPurgeEdge, mockPurgeAllPages, mockSendEmail, mockSendPush } = vi.hoisted(() => ({
  mockPurgeEdge: vi.fn().mockResolvedValue(undefined),
  mockPurgeAllPages: vi.fn().mockResolvedValue(undefined),
  mockSendEmail: vi.fn().mockResolvedValue(undefined),
  mockSendPush: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/edge-cache', () => ({
  purgeEdgeCache: mockPurgeEdge,
  purgeAllPublicPages: mockPurgeAllPages,
}))
vi.mock('../../server/utils/cf-env', () => ({
  waitUntil: (_event: unknown, promise: Promise<unknown>) => { void promise },
}))
vi.mock('../../server/utils/email', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmail: mockSendEmail,
}))
vi.mock('../../server/utils/webpush', () => ({ sendPushToUser: mockSendPush }))

const { default: listMenusHandler } = await import('../../server/api/v1/menus/index.get')
const { default: getMenuHandler } = await import('../../server/api/v1/menus/[id].get')
const { default: patchMenuHandler } = await import('../../server/api/v1/menus/[id].patch')
const { default: deleteMenuHandler } = await import('../../server/api/v1/menus/[id].delete')
const { default: listNotificationsHandler } = await import('../../server/api/v1/notifications/index.get')
const { default: readNotificationHandler } = await import('../../server/api/v1/notifications/[id]/read.post')
const { sendNotification } = await import('../../server/utils/notify')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-menus-notif-01'
const OTHER = 'site-menus-notif-02'
let editorId: string
let viewerId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'mn.localhost' })
  await seedSite(db, { id: OTHER, domain: 'mn2.localhost' })
  editorId = await seedUser(db, { email: 'editor@mn.test', name: 'Ed' })
  viewerId = await seedUser(db, { email: 'viewer@mn.test' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, viewerId, SITE, 'viewer')
  await seedRole(db, editorId, OTHER, 'editor')
})

afterAll(teardownTestDb)
beforeEach(() => {
  mockPurgeEdge.mockClear()
  mockPurgeAllPages.mockClear()
  mockSendEmail.mockClear()
  mockSendPush.mockClear()
})

function ev(userId: string, opts: { siteId?: string; body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

async function seedMenu(siteId: string, overrides: Partial<typeof menus.$inferInsert> = {}) {
  const id = ulid()
  await getCurrentTestDb().insert(menus).values({ id, siteId, name: 'Menu', items: [], ...overrides })
  return id
}

describe('menu reads', () => {
  it('lists only this site\'s menus and 404s on another site\'s id', async () => {
    const mine = await seedMenu(SITE, { name: 'Main', location: 'header' })
    const theirs = await seedMenu(OTHER, { name: 'Foreign' })

    const list = await (listMenusHandler as Handler)(ev(viewerId)) as { menus: { name: string }[] }
    expect(list.menus.map(m => m.name)).toContain('Main')
    expect(list.menus.map(m => m.name)).not.toContain('Foreign')

    expect(await (getMenuHandler as Handler)(ev(viewerId, { params: { id: mine } }))).toMatchObject({ name: 'Main' })
    await expect((getMenuHandler as Handler)(ev(viewerId, { params: { id: theirs } }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('PATCH /api/v1/menus/:id', () => {
  it('updates nested items, applying the default target', async () => {
    const id = await seedMenu(SITE, { location: 'sidebar' })
    await (patchMenuHandler as Handler)(ev(editorId, {
      params: { id },
      body: { items: [{ label: 'Docs', url: '/docs', children: [{ label: 'API', url: '/docs/api' }] }] },
    }))
    const row = await getCurrentTestDb().query.menus.findFirst({ where: eq(menus.id, id) })
    expect(row?.items).toEqual([
      { label: 'Docs', url: '/docs', target: '_self', children: [{ label: 'API', url: '/docs/api', target: '_self' }] },
    ])
    expect(mockPurgeEdge).toHaveBeenCalledWith(expect.anything(), ['/api/public/menus/sidebar'])
    expect(mockPurgeAllPages).not.toHaveBeenCalled()
  })

  it('purges both old and new locations when a menu moves, plus all pages for header/footer', async () => {
    const id = await seedMenu(SITE, { location: 'sidebar' })
    await (patchMenuHandler as Handler)(ev(editorId, { params: { id }, body: { location: 'footer' } }))
    const paths = mockPurgeEdge.mock.calls[0][1] as string[]
    expect(paths.sort()).toEqual(['/api/public/menus/footer', '/api/public/menus/sidebar'])
    expect(mockPurgeAllPages).toHaveBeenCalledWith(expect.anything(), SITE)
  })

  it('clears the location when set to null', async () => {
    const id = await seedMenu(SITE, { location: 'header' })
    await (patchMenuHandler as Handler)(ev(editorId, { params: { id }, body: { location: null } }))
    const row = await getCurrentTestDb().query.menus.findFirst({ where: eq(menus.id, id) })
    expect(row?.location).toBeNull()
  })

  it('rejects an unknown location and a javascript-free but invalid target', async () => {
    const id = await seedMenu(SITE)
    await expect((patchMenuHandler as Handler)(ev(editorId, { params: { id }, body: { location: 'popup' } })))
      .rejects.toMatchObject({ statusCode: 422 })
    await expect((patchMenuHandler as Handler)(ev(editorId, { params: { id }, body: { items: [{ label: 'x', target: '_parent' }] } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('cannot update another site\'s menu', async () => {
    const theirs = await seedMenu(OTHER, { name: 'Foreign' })
    await expect((patchMenuHandler as Handler)(ev(editorId, { params: { id: theirs }, body: { name: 'Hijacked' } })))
      .rejects.toMatchObject({ statusCode: 404 })
    const row = await getCurrentTestDb().query.menus.findFirst({ where: eq(menus.id, theirs) })
    expect(row?.name).toBe('Foreign')
  })
})

describe('DELETE /api/v1/menus/:id', () => {
  it('deletes and purges the header location plus every page', async () => {
    const id = await seedMenu(SITE, { location: 'header' })
    await (deleteMenuHandler as Handler)(ev(editorId, { params: { id } }))
    expect(await getCurrentTestDb().query.menus.findFirst({ where: eq(menus.id, id) })).toBeUndefined()
    expect(mockPurgeEdge).toHaveBeenCalledWith(expect.anything(), ['/api/public/menus/header'])
    expect(mockPurgeAllPages).toHaveBeenCalled()
  })

  it('skips cache purging for a menu with no location', async () => {
    const id = await seedMenu(SITE, { location: null })
    await (deleteMenuHandler as Handler)(ev(editorId, { params: { id } }))
    expect(mockPurgeEdge).not.toHaveBeenCalled()
  })
})

describe('notifications', () => {
  it('sendNotification persists a row and only emails/pushes when asked', async () => {
    await sendNotification({ siteId: SITE, userId: editorId, type: 'test', title: 'Hi', body: 'plain' }, ev(editorId))
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()

    await sendNotification({
      siteId: SITE, userId: editorId, type: 'test', title: 'Alert', body: '<script>x</script>',
      sendEmailNotification: true, sendPush: true, pushUrl: '/admin',
    }, ev(editorId))

    const email = mockSendEmail.mock.calls[0][1] as { to: string; html: string; subject: string }
    expect(email.to).toBe('editor@mn.test')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(mockSendPush).toHaveBeenCalledWith(expect.anything(), editorId, expect.objectContaining({ url: '/admin' }))
  })

  it('does not fail when email or push delivery fails', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('smtp down'))
    mockSendPush.mockRejectedValueOnce(new Error('push down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendNotification({
      siteId: SITE, userId: editorId, type: 't', title: 'T', body: 'B', sendEmailNotification: true, sendPush: true,
    }, ev(editorId))).resolves.toBeUndefined()
    spy.mockRestore()
  })

  it('lists only the caller\'s notifications on the current site', async () => {
    const db = getCurrentTestDb()
    await db.insert(notifications).values([
      { id: ulid(), siteId: SITE, userId: viewerId, type: 't', title: 'mine', body: 'b' },
      { id: ulid(), siteId: OTHER, userId: editorId, type: 't', title: 'other-site', body: 'b' },
    ])
    const res = await (listNotificationsHandler as Handler)(ev(editorId)) as { notifications: { title: string; userId: string; siteId: string }[] }
    expect(res.notifications.length).toBeGreaterThan(0)
    expect(res.notifications.every(n => n.userId === editorId && n.siteId === SITE)).toBe(true)
  })

  it('marks a notification read, but cannot mark someone else\'s', async () => {
    const db = getCurrentTestDb()
    const mine = ulid()
    const theirs = ulid()
    await db.insert(notifications).values([
      { id: mine, siteId: SITE, userId: editorId, type: 't', title: 'a', body: 'b' },
      { id: theirs, siteId: SITE, userId: viewerId, type: 't', title: 'a', body: 'b' },
    ])
    await (readNotificationHandler as Handler)(ev(editorId, { params: { id: mine } }))
    await (readNotificationHandler as Handler)(ev(editorId, { params: { id: theirs } }))

    const a = await db.query.notifications.findFirst({ where: eq(notifications.id, mine) })
    const b = await db.query.notifications.findFirst({ where: and(eq(notifications.id, theirs)) })
    expect(a?.readAt).not.toBeNull()
    expect(b?.readAt).toBeNull()
  })
})
