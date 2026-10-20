/**
 * Password-protected pages (client galleries): the editor write path (hash kept, never
 * returned), the public gate (401 without the content), unlocking via the password form,
 * staff access, and that changing the password revokes old unlocks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import patchHandler from '../../server/api/v1/content/[id].patch'
import getHandler from '../../server/api/v1/content/[id].get'
import postHandler from '../../server/api/v1/content/index.post'
import publicPageHandler from '../../server/api/public/pages/[...slug].get'
import unlockHandler from '../../server/api/public/page-unlock.post'
import commentsGetHandler from '../../server/api/v1/content/[id]/comments.get'
import { getIndexableEntries } from '../../server/utils/sitemap-entries'
import { getSeoSettings } from '../../server/utils/seo'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/analytics', () => ({ trackPageView: vi.fn() }))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))

const SITE = 'site-page-password-01'
let editorId: string
let memberId: string
let typeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'page-password.localhost' })
  editorId = await seedUser(db, { email: 'editor@page-password.test' })
  await seedRole(db, editorId, SITE, 'editor')
  memberId = await seedUser(db, { email: 'member@page-password.test' })
  await seedRole(db, memberId, SITE, 'member')
  typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Page', singularName: 'Page' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>
const run = (h: unknown, e: H3Event) => (h as HandlerFn)(e)

function editor(body?: unknown, id?: string) {
  return createMockEvent({ siteId: SITE, session: { user: { id: editorId, name: 'Ed', email: 'editor@page-password.test' } }, body, params: id ? { id } : undefined }) as unknown as H3Event
}
function visitor(slug: string, cookies: Record<string, string> = {}, userId?: string) {
  return createMockEvent({
    siteId: SITE,
    params: { slug },
    cookies,
    session: userId ? { user: { id: userId, name: 'U', email: 'u@page-password.test' } } : null,
  }) as unknown as H3Event
}
function unlockEvent(path: string, password: string) {
  return createMockEvent({ siteId: SITE, body: { path, password }, session: null }) as unknown as H3Event
}
/** Unlocks and returns the cookie(s) the response set. */
async function unlock(path: string, password: string) {
  const e = unlockEvent(path, password)
  await run(unlockHandler, e)
  return { ...(e as unknown as { _cookies: Record<string, string> })._cookies }
}

async function makeProtectedPage(slug: string, password = 'smith2027') {
  const id = await seedContentItem(getCurrentTestDb(), SITE, typeId, { slug, title: `Gallery ${slug}`, status: 'published', content: { type: 'canvas', blocks: [] } })
  await run(patchHandler, editor({ settings: { access: 'password' }, pagePassword: password }, id))
  return id
}

describe('editor write path', () => {
  it('refuses a password page with no password, and hashes one when given', async () => {
    const id = await seedContentItem(getCurrentTestDb(), SITE, typeId, { slug: 'no-pass-yet', status: 'draft' })
    await expect(run(patchHandler, editor({ settings: { access: 'password' } }, id))).rejects.toMatchObject({ statusCode: 422 })

    await run(patchHandler, editor({ settings: { access: 'password' }, pagePassword: 'secret-1' }, id))
    const row = await getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, id) })
    expect(row?.visibility).toBe('password')
    const settings = row?.settings as Record<string, unknown>
    expect(settings.passwordHash).toMatch(/\S{20,}/)
    expect(JSON.stringify(settings)).not.toContain('secret-1')
  })

  it('never returns the hash to the editor, keeps it across saves, and drops it when made public', async () => {
    const id = await makeProtectedPage('keep-hash')
    const db = getCurrentTestDb()
    const hashBefore = ((await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) }))?.settings as Record<string, unknown>).passwordHash

    const got = await run(getHandler, editor(undefined, id)) as { settings: Record<string, unknown> }
    expect(got.settings).toEqual({ access: 'password', hasPassword: true })

    // An autosave sends settings without the hash (and a client can't smuggle one in).
    await run(patchHandler, editor({ title: 'Renamed', settings: { access: 'password', passwordHash: 'forged' } }, id))
    const kept = (await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) }))?.settings as Record<string, unknown>
    expect(kept.passwordHash).toBe(hashBefore)

    await run(patchHandler, editor({ settings: { access: 'public' } }, id))
    const opened = await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) })
    expect(opened?.visibility).toBe('public')
    expect(opened?.settings).toEqual({ access: 'public' })
  })

  it('creates a password page in one request', async () => {
    const res = await run(postHandler, editor({ title: 'New gallery', slug: 'new-gallery', status: 'draft', settings: { access: 'password' }, pagePassword: 'pw-1234' })) as { id: string }
    const row = await getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, res.id) })
    expect(row?.visibility).toBe('password')
  })

  it('rejects a too-short password', async () => {
    const id = await seedContentItem(getCurrentTestDb(), SITE, typeId, { slug: 'short-pw', status: 'draft' })
    await expect(run(patchHandler, editor({ settings: { access: 'password' }, pagePassword: 'abc' }, id))).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('public gate', () => {
  it('answers 401 with only the title until unlocked, then serves the page uncached and noindexed', async () => {
    await makeProtectedPage('smith-wedding')

    const err = await run(publicPageHandler, visitor('smith-wedding')).catch(e => e) as { statusCode: number; data: Record<string, unknown> }
    expect(err.statusCode).toBe(401)
    expect(err.data).toEqual({ passwordRequired: true, title: 'Gallery smith-wedding' })

    await expect(run(unlockHandler, unlockEvent('smith-wedding', 'wrong'))).rejects.toMatchObject({ statusCode: 401 })

    const cookies = await unlock('smith-wedding', 'smith2027')
    expect(Object.keys(cookies)).toEqual([expect.stringMatching(/^nf_unlock_/)])

    const e = visitor('smith-wedding', cookies)
    const page = await run(publicPageHandler, e) as { title: string; robots: string }
    expect(page.title).toBe('Gallery smith-wedding')
    expect(page.robots).toBe('noindex,nofollow')
    const headers = (e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders
    expect(headers['Cache-Control']).toBe('private, no-store')
  })

  it('does not accept one page\'s unlock for another, or a tampered cookie', async () => {
    await makeProtectedPage('gallery-a', 'alpha-pass')
    await makeProtectedPage('gallery-b', 'bravo-pass')
    const cookiesA = await unlock('gallery-a', 'alpha-pass')
    const [nameA, valueA] = Object.entries(cookiesA)[0]!

    await expect(run(publicPageHandler, visitor('gallery-b', cookiesA))).rejects.toMatchObject({ statusCode: 401 })
    const tampered = `${Number(valueA.split('.')[0]) + 999999}.${valueA.split('.')[1]}`
    await expect(run(publicPageHandler, visitor('gallery-a', { [nameA]: tampered }))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('locks out old unlocks when the password changes', async () => {
    const id = await makeProtectedPage('rotate-me', 'first-pass')
    const cookies = await unlock('rotate-me', 'first-pass')
    await run(publicPageHandler, visitor('rotate-me', cookies))

    await run(patchHandler, editor({ settings: { access: 'password' }, pagePassword: 'second-pass' }, id))
    await expect(run(publicPageHandler, visitor('rotate-me', cookies))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('lets signed-in staff in without the password, but not a member', async () => {
    await makeProtectedPage('staff-view')
    await expect(run(publicPageHandler, visitor('staff-view', {}, editorId))).resolves.toMatchObject({ title: 'Gallery staff-view' })
    await expect(run(publicPageHandler, visitor('staff-view', {}, memberId))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('404s the unlock form for pages that aren\'t password protected', async () => {
    await seedContentItem(getCurrentTestDb(), SITE, typeId, { slug: 'open-page', status: 'published' })
    await expect(run(unlockHandler, unlockEvent('open-page', 'anything'))).rejects.toMatchObject({ statusCode: 404 })
    await expect(run(unlockHandler, unlockEvent('nope', 'anything'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('gates the page\'s comments the same way', async () => {
    const id = await makeProtectedPage('commented-gallery')
    const anon = createMockEvent({ siteId: SITE, params: { id }, session: null }) as unknown as H3Event
    // 404, like any page a visitor can't see — it doesn't confirm the page exists.
    await expect(run(commentsGetHandler, anon)).rejects.toMatchObject({ statusCode: 404 })

    const cookies = await unlock('commented-gallery', 'smith2027')
    const unlocked = createMockEvent({ siteId: SITE, params: { id }, session: null, cookies }) as unknown as H3Event
    await expect(run(commentsGetHandler, unlocked)).resolves.toBeDefined()
  })

  it('keeps password pages out of the sitemap', async () => {
    await makeProtectedPage('not-in-sitemap')
    const db = getCurrentTestDb()
    const { entries } = await getIndexableEntries(db, SITE, await getSeoSettings(db, SITE), 1000)
    expect(entries.map(e => e.path)).not.toContain('/not-in-sitemap')
  })
})
