/**
 * Central sign-in (server/utils/accounts-origin.ts, site-auth.ts): the one-time-code
 * handoff from the accounts origin to a site's own domain, the site-scoped session it
 * creates, and the routing that keeps Better Auth and account-wide actions off site domains.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { sessions, siteAuthCodes, siteSessions, userSiteRoles } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const ACCOUNTS = 'https://accounts.example.test'
const SITE_A = 'site-central-a'
const SITE_B = 'site-central-b'
const SITE_SUSPENDED = 'site-central-c'

const { default: startHandler } = await import('../../server/routes/_nuxflow/auth/start.get')
const { default: callbackHandler } = await import('../../server/routes/_nuxflow/auth/callback.get')
const { default: authorizeGet } = await import('../../server/api/accounts/authorize.get')
const { default: authorizePost } = await import('../../server/api/accounts/authorize.post')
const { default: signOutHandler } = await import('../../server/api/v1/auth/sign-out.post')
const { default: routing } = await import('../../server/middleware/03.accounts-routing')
const { getSiteSession, safeReturnPath } = await import('../../server/utils/site-auth')
const auth = await import('../../server/utils/auth')

type Handler = (e: H3Event) => Promise<unknown> | unknown
type MockEvent = ReturnType<typeof createMockEvent>

let memberId: string
let strangerId: string
let parentSessionId: string

const originalRuntimeConfig = globalThis.useRuntimeConfig

function onSite(siteId: string, domain: string, opts: Parameters<typeof createMockEvent>[0] = {}) {
  return createMockEvent({ siteId, headers: { host: domain }, ...opts })
}

function onAccounts(userId: string | null, opts: Parameters<typeof createMockEvent>[0] = {}) {
  return createMockEvent({
    siteId: undefined,
    headers: { host: 'accounts.example.test' },
    session: userId
      ? { user: { id: userId, name: 'U', email: `${userId}@example.test` }, session: { id: parentSessionId } } as never
      : null,
    ...opts,
  })
}

/** Runs the full handoff for `userId` into site A and returns the site-session cookie. */
async function signInToSiteA(userId: string, returnTo = '/admin'): Promise<{ cookie: string; site: MockEvent }> {
  const start = onSite(SITE_A, 'a.example.test', { query: { return_to: returnTo } })
  await (startHandler as Handler)(start as unknown as H3Event)
  const stateCookie = start._cookies.nuxflow_auth_state!
  const { state } = JSON.parse(stateCookie) as { state: string }

  const { redirect } = await (authorizePost as Handler)(onAccounts(userId, { body: { site: SITE_A, state } }) as unknown as H3Event) as { redirect: string }
  const url = new URL(redirect)

  const callback = onSite(SITE_A, 'a.example.test', {
    query: Object.fromEntries(url.searchParams),
    cookies: { nuxflow_auth_state: stateCookie },
  })
  await (callbackHandler as Handler)(callback as unknown as H3Event)
  return { cookie: callback._cookies['__Host-nuxflow_site']!, site: callback }
}

beforeAll(async () => {
  const base = originalRuntimeConfig()
  globalThis.useRuntimeConfig = () => ({ ...base, public: { ...base.public, accountsUrl: ACCOUNTS } })

  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE_A, domain: 'a.example.test', name: 'Site A' })
  await seedSite(db, { id: SITE_B, domain: 'b.example.test', name: 'Site B' })
  await seedSite(db, { id: SITE_SUSPENDED, domain: 'c.example.test', status: 'suspended' })
  memberId = await seedUser(db, { email: 'member@central.test' })
  strangerId = await seedUser(db, { email: 'stranger@central.test' })
  await seedRole(db, memberId, SITE_A, 'editor')

  // The accounts-origin (Better Auth) session every site session hangs off.
  parentSessionId = ulid()
  await db.insert(sessions).values({
    id: parentSessionId,
    token: ulid(),
    userId: memberId,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  })
})

afterAll(async () => {
  globalThis.useRuntimeConfig = originalRuntimeConfig
  await teardownTestDb()
})

describe('the handoff', () => {
  it('start: binds the browser with a state cookie and goes to the accounts origin', async () => {
    const event = onSite(SITE_A, 'a.example.test', { query: { return_to: '/admin/content' } })
    await (startHandler as Handler)(event as unknown as H3Event)
    const target = new URL(event._redirect!.url)
    expect(target.origin).toBe(ACCOUNTS)
    expect(target.pathname).toBe('/authorize')
    expect(target.searchParams.get('site')).toBe(SITE_A)
    const cookie = JSON.parse(event._cookies.nuxflow_auth_state!) as { state: string; returnTo: string }
    expect(cookie.state).toBe(target.searchParams.get('state'))
    expect(cookie.returnTo).toBe('/admin/content')
  })

  it('only ever returns to a same-site path', () => {
    expect(safeReturnPath('/admin')).toBe('/admin')
    for (const bad of ['//evil.com/x', 'https://evil.com', '/\\evil.com', 'admin', '/a\r\nSet-Cookie: x=1', undefined]) {
      expect(safeReturnPath(bad)).toBe('/admin')
    }
  })

  it('authorize: sends the code to the site\'s real callback, built from its stored domain', async () => {
    const res = await (authorizePost as Handler)(onAccounts(memberId, { body: { site: SITE_A, state: 's'.repeat(24) } }) as unknown as H3Event) as { redirect: string }
    const url = new URL(res.redirect)
    expect(`${url.origin}${url.pathname}`).toBe('https://a.example.test/_nuxflow/auth/callback')
    expect(url.searchParams.get('state')).toBe('s'.repeat(24))
    // Stored hashed, never the raw code.
    const rows = await getCurrentTestDb().query.siteAuthCodes.findMany({ where: eq(siteAuthCodes.siteId, SITE_A) })
    expect(rows.some(r => r.codeHash === url.searchParams.get('code'))).toBe(false)
  })

  it('authorize: refuses off the accounts origin, without a session, and for a suspended site', async () => {
    await expect((authorizePost as Handler)(onSite(SITE_A, 'a.example.test', { body: { site: SITE_A, state: 's'.repeat(24) } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 404 })
    await expect((authorizePost as Handler)(onAccounts(null, { body: { site: SITE_A, state: 's'.repeat(24) } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 401 })
    await expect((authorizePost as Handler)(onAccounts(memberId, { body: { site: SITE_SUSPENDED, state: 's'.repeat(24) } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('authorize: reports membership so non-members get an explicit confirmation step', async () => {
    const member = await (authorizeGet as Handler)(onAccounts(memberId, { query: { site: SITE_A } }) as unknown as H3Event) as { isMember: boolean }
    const stranger = await (authorizeGet as Handler)(onAccounts(strangerId, { query: { site: SITE_A } }) as unknown as H3Event) as { isMember: boolean; user: unknown }
    expect(member.isMember).toBe(true)
    expect(stranger.isMember).toBe(false)
    expect(stranger.user).toBeTruthy()
  })

  it('authorize: "join" adds the member role only where public registration is open', async () => {
    const db = getCurrentTestDb()
    await expect((authorizePost as Handler)(onAccounts(strangerId, { body: { site: SITE_B, state: 's'.repeat(24), join: true } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 403 })
    await seedSetting(db, SITE_B, 'auth.allow_public_registration', 'true')
    await (authorizePost as Handler)(onAccounts(strangerId, { body: { site: SITE_B, state: 's'.repeat(24), join: true } }) as unknown as H3Event)
    const role = await db.query.userSiteRoles.findFirst({ where: and(eq(userSiteRoles.userId, strangerId), eq(userSiteRoles.siteId, SITE_B)) })
    expect(role?.role).toBe('member')
  })

  it('callback: exchanges the code for a site session and returns to the saved path', async () => {
    const { cookie, site } = await signInToSiteA(memberId, '/admin/media')
    expect(cookie).toBeTruthy()
    expect(site._redirect?.url).toBe('/admin/media')
    const rows = await getCurrentTestDb().query.siteSessions.findMany({ where: eq(siteSessions.userId, memberId) })
    expect(rows.some(r => r.siteId === SITE_A && r.parentSessionId === parentSessionId)).toBe(true)
    // Stored hashed.
    expect(rows.some(r => r.tokenHash === cookie)).toBe(false)
  })

  it('callback: a code works once, only with this browser\'s state, and only on its own site', async () => {
    const start = onSite(SITE_A, 'a.example.test')
    await (startHandler as Handler)(start as unknown as H3Event)
    const stateCookie = start._cookies.nuxflow_auth_state!
    const { state } = JSON.parse(stateCookie) as { state: string }
    const { redirect } = await (authorizePost as Handler)(onAccounts(memberId, { body: { site: SITE_A, state } }) as unknown as H3Event) as { redirect: string }
    const query = Object.fromEntries(new URL(redirect).searchParams)

    // Wrong browser (no state cookie) — nothing issued, back to the start.
    const noCookie = onSite(SITE_A, 'a.example.test', { query })
    await (callbackHandler as Handler)(noCookie as unknown as H3Event)
    expect(noCookie._redirect?.url).toContain('/_nuxflow/auth/start')
    expect(noCookie._cookies['__Host-nuxflow_site']).toBeUndefined()

    // Another site's callback can't redeem it.
    const otherSite = onSite(SITE_B, 'b.example.test', { query, cookies: { nuxflow_auth_state: stateCookie } })
    await (callbackHandler as Handler)(otherSite as unknown as H3Event)
    expect(otherSite._cookies['__Host-nuxflow_site']).toBeUndefined()
    // …and that attempt consumed it, so the real site can't replay it either.
    const replay = onSite(SITE_A, 'a.example.test', { query, cookies: { nuxflow_auth_state: stateCookie } })
    await (callbackHandler as Handler)(replay as unknown as H3Event)
    expect(replay._cookies['__Host-nuxflow_site']).toBeUndefined()
  })

  it('callback: an expired code is refused', async () => {
    const start = onSite(SITE_A, 'a.example.test')
    await (startHandler as Handler)(start as unknown as H3Event)
    const stateCookie = start._cookies.nuxflow_auth_state!
    const { state } = JSON.parse(stateCookie) as { state: string }
    const { redirect } = await (authorizePost as Handler)(onAccounts(memberId, { body: { site: SITE_A, state } }) as unknown as H3Event) as { redirect: string }
    await getCurrentTestDb().update(siteAuthCodes).set({ expiresAt: '2000-01-01T00:00:00.000Z' })

    const callback = onSite(SITE_A, 'a.example.test', { query: Object.fromEntries(new URL(redirect).searchParams), cookies: { nuxflow_auth_state: stateCookie } })
    await (callbackHandler as Handler)(callback as unknown as H3Event)
    expect(callback._cookies['__Host-nuxflow_site']).toBeUndefined()
  })
})

describe('site sessions', () => {
  it('are valid on their own site only', async () => {
    const { cookie } = await signInToSiteA(memberId)
    const onA = await getSiteSession(onSite(SITE_A, 'a.example.test', { cookies: { '__Host-nuxflow_site': cookie } }) as unknown as H3Event)
    expect(onA?.user.id).toBe(memberId)
    const onB = await getSiteSession(onSite(SITE_B, 'b.example.test', { cookies: { '__Host-nuxflow_site': cookie } }) as unknown as H3Event)
    expect(onB).toBeNull()
  })

  it('back the app\'s session helpers on a site domain — but never account-wide actions', async () => {
    const { cookie } = await signInToSiteA(memberId)
    const event = onSite(SITE_A, 'a.example.test', { cookies: { '__Host-nuxflow_site': cookie } }) as unknown as H3Event
    expect((await auth.getAuthSession(event))?.user.id).toBe(memberId)
    await expect(auth.requireAccountSession(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('sign-out ends this site\'s session only', async () => {
    const { cookie } = await signInToSiteA(memberId)
    const event = onSite(SITE_A, 'a.example.test', { cookies: { '__Host-nuxflow_site': cookie }, method: 'POST' })
    await (signOutHandler as Handler)(event as unknown as H3Event)
    expect(await getSiteSession(onSite(SITE_A, 'a.example.test', { cookies: { '__Host-nuxflow_site': cookie } }) as unknown as H3Event)).toBeNull()
  })

  it('all end when the accounts-origin session ends (sign-out there, password reset, account deletion)', async () => {
    const db = getCurrentTestDb()
    const { cookie } = await signInToSiteA(memberId)
    await db.delete(sessions).where(eq(sessions.id, parentSessionId))
    expect(await getSiteSession(onSite(SITE_A, 'a.example.test', { cookies: { '__Host-nuxflow_site': cookie } }) as unknown as H3Event)).toBeNull()
    expect(await db.query.siteSessions.findMany({ where: eq(siteSessions.parentSessionId, parentSessionId) })).toHaveLength(0)
  })
})

describe('routing (03.accounts-routing.ts)', () => {
  const run = (host: string, path: string, method = 'GET') => {
    const event = Object.assign(createMockEvent({ headers: { host }, path, method }), { method })
    return { event, result: (routing as Handler)(event as unknown as H3Event) }
  }

  it('serves no Better Auth endpoint on a site domain', () => {
    expect(() => run('a.example.test', '/api/auth/sign-in/email', 'POST').result).toThrow()
    expect(() => run('a.example.test', '/api/auth/passkey/verify-registration', 'POST').result).toThrow()
  })

  it('forwards a site\'s old sign-in pages to the handoff or the accounts origin', async () => {
    const login = run('a.example.test', '/login?redirect=/admin/users')
    await login.result
    expect(login.event._redirect?.url).toBe(`/_nuxflow/auth/start?${new URLSearchParams({ return_to: '/admin/users' })}`)
    const reset = run('a.example.test', '/reset-password?token=abc')
    await reset.result
    expect(reset.event._redirect?.url).toBe(`${ACCOUNTS}/reset-password?token=abc`)
  })

  it('serves only sign-in pages and account APIs on the accounts origin, locked down', async () => {
    expect(() => run('accounts.example.test', '/admin').result).toThrow()
    expect(() => run('accounts.example.test', '/api/v1/content').result).toThrow()
    expect(() => run('accounts.example.test', '/some-page').result).toThrow()
    const login = run('accounts.example.test', '/login')
    await login.result
    expect(login.event._responseHeaders['X-Frame-Options']).toBe('DENY')
    expect(login.event._responseHeaders['Referrer-Policy']).toBe('no-referrer')
    const root = run('accounts.example.test', '/')
    await root.result
    expect(root.event._redirect?.url).toBe('/account')
  })
})
