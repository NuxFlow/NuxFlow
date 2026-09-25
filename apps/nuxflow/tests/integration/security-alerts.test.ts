/**
 * New-device sign-in detection (notifications table as device history) and the
 * host → site resolution the /api/auth/** alerts depend on.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { notifications } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/system-event', () => ({
  createSystemEvent: (opts: { siteId?: string; host?: string }) =>
    createMockEvent({ siteId: opts.siteId, headers: { host: opts.host ?? 'localhost' } }),
}))

const { mockTemplated, mockPush } = vi.hoisted(() => ({
  mockTemplated: vi.fn().mockResolvedValue({}),
  mockPush: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/email-template', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTemplatedEmail: mockTemplated,
}))
vi.mock('../../server/utils/webpush', () => ({ sendPushToUser: mockPush }))

const { alertOnNewSignIn, resolveSiteIdForHost } = await import('../../server/utils/security-alerts')

const SITE = 'site-sec-alerts-01'
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const CHROME_WIN_NEWER = CHROME_WIN.replace('Chrome/140.0', 'Chrome/141.0')
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
let userId: string

// /api/auth/** events carry no siteId — the alert has to find the site from Host.
function authRequest(country = 'GB') {
  const e = createMockEvent({ headers: { 'host': 'sec.localhost', 'cf-ipcountry': country } }) as unknown as { context: Record<string, unknown> }
  delete e.context.siteId
  return e as unknown as H3Event
}

async function signInAlerts() {
  return getCurrentTestDb().query.notifications.findMany({
    where: and(eq(notifications.userId, userId), eq(notifications.type, 'security.new_sign_in')),
  })
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'sec.localhost' })
  userId = await seedUser(db, { email: 'owner@sec.test' })
  await seedRole(db, userId, SITE, 'admin')
})

afterAll(teardownTestDb)

beforeEach(() => {
  mockTemplated.mockClear()
  mockPush.mockClear()
})

describe('alertOnNewSignIn', () => {
  it('records the first-ever sign-in silently, then stays quiet for the same device', async () => {
    await alertOnNewSignIn(authRequest(), { userId, userAgent: CHROME_WIN, ipAddress: '203.0.113.1' })
    expect(await signInAlerts()).toHaveLength(1)
    expect(mockTemplated).not.toHaveBeenCalled()

    // A browser update or a new IP in the same country is the same device.
    await alertOnNewSignIn(authRequest(), { userId, userAgent: CHROME_WIN_NEWER, ipAddress: '203.0.113.99' })
    expect(await signInAlerts()).toHaveLength(1)
    expect(mockTemplated).not.toHaveBeenCalled()
  })

  it('emails and pushes for a new browser/OS or country', async () => {
    await alertOnNewSignIn(authRequest(), { userId, userAgent: SAFARI_IOS, ipAddress: '198.51.100.7' })
    expect(mockTemplated).toHaveBeenCalledTimes(1)
    const email = mockTemplated.mock.calls[0]![1] as { to: string; subject: string; category: string; template: { paragraphs: string[] } }
    expect(email).toMatchObject({ to: 'owner@sec.test', subject: 'New sign-in to your account', category: 'security' })
    expect(email.template.paragraphs[0]).toContain('Safari on iOS')
    expect(mockPush).toHaveBeenCalledTimes(1)

    await alertOnNewSignIn(authRequest('FR'), { userId, userAgent: CHROME_WIN, ipAddress: '192.0.2.1' })
    expect(mockTemplated).toHaveBeenCalledTimes(2)
    expect(await signInAlerts()).toHaveLength(3)
  })
})

describe('resolveSiteIdForHost', () => {
  it('matches the domain with or without a port', async () => {
    const db = getCurrentTestDb()
    expect(await resolveSiteIdForHost(db, 'sec.localhost')).toBe(SITE)
    expect(await resolveSiteIdForHost(db, 'sec.localhost:8787')).toBe(SITE)
  })

  it('falls back to the only site, but not when there are several', async () => {
    const db = getCurrentTestDb()
    expect(await resolveSiteIdForHost(db, 'unknown.test')).toBe(SITE)
    await seedSite(db, { id: 'site-sec-alerts-02', domain: 'other.localhost' })
    expect(await resolveSiteIdForHost(db, 'unknown.test')).toBeNull()
  })
})
