/**
 * Settings → Business: the `business.profile` setting saved through PATCH /api/v1/settings
 * (admins only, checked by normalizeBusinessSetting(), whole-site cache cleared) and what
 * the public site payload carries for the Opening Hours block and the LocalBusiness data.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
const mockPurgeAll = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/edge-cache', () => ({
  purgeEdgeCache: vi.fn().mockResolvedValue(undefined),
  purgeAllPublicPages: (...a: unknown[]) => mockPurgeAll(...a),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitUntil: (_e: unknown, p: Promise<unknown>) => p,
}))

const { default: getSettings } = await import('../../server/api/v1/settings/index.get')
const { default: patchSettings } = await import('../../server/api/v1/settings/index.patch')
const { default: siteRoute } = await import('../../server/api/public/site.get')
const KEY = 'business.profile'
const getRoute = async (e: H3Event) => ({ info: ((await (getSettings as Handler)(e)) as { settings: Record<string, unknown> }).settings[KEY] ?? null })
const putRoute = (e: H3Event) => (patchSettings as Handler)(e)

const SITE = 'site-business-01'
let adminId: string
let editorId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'business.localhost' })
  adminId = await seedUser(db, { email: 'admin@business.test', name: 'Admin' })
  editorId = await seedUser(db, { email: 'editor@business.test', name: 'Editor' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
})
afterAll(teardownTestDb)
beforeEach(() => mockPurgeAll.mockClear())

type Handler = (e: H3Event) => Promise<unknown>
const as = (userId: string | null, profile?: unknown) => createMockEvent({
  siteId: SITE,
  session: userId ? { user: { id: userId, name: 'U', email: 'u@business.test' } } : null,
  body: profile === undefined ? undefined : { settings: { [KEY]: profile } },
}) as unknown as H3Event

const week = {
  mon: [{ open: '09:00', close: '17:00' }], tue: [{ open: '09:00', close: '17:00' }], wed: [], thu: [], fri: [{ open: '18:00', close: '02:00' }], sat: [], sun: [],
}
const valid = {
  kind: 'CafeOrCoffeeShop', name: '', phone: '01904 123456', email: '', street: '10 High St', locality: 'York', region: '', postcode: 'YO1 8AA', country: 'gb',
  latitude: 53.96, longitude: -1.08, priceRange: '££', hoursNote: '', hours: week,
  exceptions: [{ date: '2026-12-25', slots: [], note: 'Christmas Day' }],
}

describe('Settings → Business', () => {
  it('is for admins only', async () => {
    await expect(putRoute(as(editorId, valid))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('starts empty, then saves normalised, and clears every page from the cache', async () => {
    expect((await getRoute(as(adminId))).info).toBeNull()

    await putRoute(as(adminId, valid))
    expect(mockPurgeAll).toHaveBeenCalledWith(expect.anything(), SITE)

    const again = await getRoute(as(adminId)) as { info: { kind: string; country: string; latitude: number; hours: typeof week; exceptions: unknown[] } }
    expect(again.info).toMatchObject({ kind: 'CafeOrCoffeeShop', country: 'GB', latitude: 53.96 })
    expect(again.info.hours.fri).toEqual([{ open: '18:00', close: '02:00' }])
    expect(again.info.exceptions).toEqual([{ date: '2026-12-25', slots: [], note: 'Christmas Day' }])
  })

  it('refuses bad times, bad dates and a date listed twice', async () => {
    const bad = (patch: Record<string, unknown>) => putRoute(as(adminId, { ...valid, ...patch }))
    await expect(bad({ hours: { ...week, mon: [{ open: '9am', close: '17:00' }] } })).rejects.toMatchObject({ statusCode: 422 })
    await expect(bad({ hours: { ...week, mon: [{ open: '09:00', close: '09:00' }] } })).rejects.toMatchObject({ statusCode: 422 })
    await expect(bad({ exceptions: [{ date: 'Christmas', slots: [] }] })).rejects.toMatchObject({ statusCode: 422 })
    await expect(bad({ exceptions: [{ date: '2026-12-25', slots: [] }, { date: '2026-12-25', slots: [] }] })).rejects.toMatchObject({ statusCode: 422 })
    await expect(bad({ email: 'not an email' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(bad({ country: 'Britain' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('puts the details in the public site payload', async () => {
    await putRoute(as(adminId, valid))
    const site = await (siteRoute as Handler)(as(null)) as { business: { kind: string; phone: string; hours: typeof week } | null }
    expect(site.business).toMatchObject({ kind: 'CafeOrCoffeeShop', phone: '01904 123456' })
    expect(site.business!.hours.mon).toEqual([{ open: '09:00', close: '17:00' }])
  })

  it('publishes nothing once everything is cleared', async () => {
    await putRoute(as(adminId, {
      kind: 'LocalBusiness', hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, exceptions: [],
    }))
    const site = await (siteRoute as Handler)(as(null)) as { business: unknown }
    expect(site.business).toBeNull()
    expect((await getRoute(as(adminId))).info).toBeNull()
  })
})
