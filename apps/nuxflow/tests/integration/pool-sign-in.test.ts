/**
 * Signing in to sites in member pools. Both ends: the control plane's answers
 * (utils/pool-sign-in.ts — the NuxflowControlPlane entrypoint) and the pool's side
 * (utils/pool-session.ts, the callback, getSiteSession, sign-out), plus the accounts
 * origin's pages for a pool's site (utils/accounts-sites.ts). Each side's binding to the
 * other is faked as a plain object in the Cloudflare env.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { sessions, siteDirectory, siteSessions, userSiteRoles, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const ACCOUNTS = 'https://accounts.platform.test'
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { redeemSignInCode, sessionStatus, endSession } = await import('../../server/utils/pool-sign-in')
const { issueSiteAuthCode, getSiteSession, siteCallbackUrl, siteSessionCookieName } = await import('../../server/utils/site-auth')
const { parentSessionAlive, resetPoolSessionState } = await import('../../server/utils/pool-session')
const { findSiteForAccounts, listUserSites, poolJoinSite, poolSiteForAccounts } = await import('../../server/utils/accounts-sites')
const { default: startHandler } = await import('../../server/routes/_nuxflow/auth/start.get')
const { default: callbackHandler } = await import('../../server/routes/_nuxflow/auth/callback.get')
const { default: signOutHandler } = await import('../../server/api/v1/auth/sign-out.post')
const { default: authorizeGet } = await import('../../server/api/accounts/authorize.get')
const { default: authorizePost } = await import('../../server/api/accounts/authorize.post')

type Handler = (e: H3Event) => Promise<unknown> | unknown
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }
type Config = Record<string, unknown> & { public: Record<string, unknown> }
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

/** The control plane (pool id unset) or member pool "clientx", both with central sign-in. */
function setMode(poolId: string | null) {
  g.useRuntimeConfig = () => {
    const base = baseConfig()
    return { ...base, poolId: poolId ?? '', public: { ...base.public, accountsUrl: ACCOUNTS } }
  }
}

function withEnv<T extends MockEvent>(event: T, env: Record<string, unknown>): H3Event {
  event.context.cloudflare = { env, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

const PRIMARY = 'site-cp-primary'
const POOL_SITE = 'site-in-pool'
let operatorId: string
let editorId: string
let editorSession: string

async function newSession(userId: string, ttlMs = 7 * 86_400_000): Promise<string> {
  const id = ulid()
  await getCurrentTestDb().insert(sessions).values({ id, token: ulid(), userId, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
  return id
}

beforeAll(async () => {
  setMode(null)
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, setupCompleted: true })
  // In this single test database the pool's site sits beside the control plane's tables.
  await seedSite(db, { id: POOL_SITE, name: 'Client', domain: 'client.example', setupCompleted: true })
  await seedSetting(db, POOL_SITE, 'auth.allow_public_registration', 'true')
  await db.insert(siteDirectory).values({ hostname: 'client.example', poolId: 'clientx', poolSiteId: POOL_SITE })
  operatorId = await seedUser(db, { email: 'operator@platform.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  editorId = await seedUser(db, { email: 'editor@client.test', name: 'Edie' })
  editorSession = await newSession(editorId)
})
afterAll(async () => {
  g.useRuntimeConfig = baseConfig
  await teardownTestDb()
})
afterEach(() => {
  setMode(null)
  resetPoolSessionState()
})

// ── The control plane's answers ──────────────────────────────────────────────────────

describe('control plane: redeemSignInCode', () => {
  const redirectUri = 'https://client.example/_nuxflow/auth/callback'
  const issue = (userId: string, parentSessionId: string) =>
    issueSiteAuthCode(createMockEvent() as unknown as H3Event, { userId, siteId: POOL_SITE, parentSessionId, redirectUri })

  it('uses the code up and says who it was for', async () => {
    const code = await issue(editorId, editorSession)
    const grant = await redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL, poolId: 'clientx', code, siteId: POOL_SITE, redirectUri })
    expect(grant).toMatchObject({
      user: { id: editorId, email: 'editor@client.test', name: 'Edie' },
      parentSessionId: editorSession,
      platformSuperAdmin: false,
    })
    expect(await redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL, poolId: 'clientx', code, siteId: POOL_SITE, redirectUri })).toBeNull()
  })

  it('refuses a code for a site the calling pool doesn\'t serve — and still uses it up', async () => {
    const code = await issue(editorId, editorSession)
    expect(await redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL, poolId: 'otherpool', code, siteId: POOL_SITE, redirectUri })).toBeNull()
    expect(await redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL, poolId: 'clientx', code, siteId: POOL_SITE, redirectUri })).toBeNull()
  })

  it('refuses a code whose sign-in has since ended', async () => {
    const parent = await newSession(editorId)
    const code = await issue(editorId, parent)
    await getCurrentTestDb().update(sessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(sessions.id, parent))
    expect(await redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL, poolId: 'clientx', code, siteId: POOL_SITE, redirectUri })).toBeNull()
  })

  it('tells the pool when the person is the platform\'s super admin', async () => {
    const parent = await newSession(operatorId)
    const code = await issue(operatorId, parent)
    expect((await redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL, poolId: 'clientx', code, siteId: POOL_SITE, redirectUri }))!.platformSuperAdmin).toBe(true)
  })

  it('refuses a pool two protocol versions away', async () => {
    await expect(redeemSignInCode(getCurrentTestDb(), { protocol: POOL_PROTOCOL + 2, poolId: 'clientx', code: 'x', siteId: POOL_SITE, redirectUri })).rejects.toThrow(/Incompatible/)
  })
})

describe('control plane: sessionStatus and endSession', () => {
  it('reports a live sign-in, slides it forward, and ends it', async () => {
    const db = getCurrentTestDb()
    const parent = await newSession(editorId, 60_000)
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString()
    expect(await sessionStatus(db, { protocol: POOL_PROTOCOL, parentSessionId: parent, userId: editorId, extendTo: later }))
      .toEqual({ alive: true, expiresAt: later, platformSuperAdmin: false })
    // Someone else's id can't be used to probe or end it.
    expect((await sessionStatus(db, { protocol: POOL_PROTOCOL, parentSessionId: parent, userId: operatorId })).alive).toBe(false)
    expect(await endSession(db, { protocol: POOL_PROTOCOL, parentSessionId: parent, userId: operatorId })).toEqual({ ended: false })
    expect(await endSession(db, { protocol: POOL_PROTOCOL, parentSessionId: parent, userId: editorId })).toEqual({ ended: true })
    expect((await sessionStatus(db, { protocol: POOL_PROTOCOL, parentSessionId: parent, userId: editorId })).alive).toBe(false)
  })
})

// ── The pool's side ──────────────────────────────────────────────────────────────────

/** A fake CONTROL_PLANE binding: grants sign-ins for a person not in this database yet. */
function fakeControlPlane(opts: { alive?: () => boolean; psa?: boolean } = {}) {
  const calls = { redeem: [] as unknown[], status: [] as unknown[], end: [] as unknown[] }
  const personId = `pool-person-${ulid()}`
  const parentSessionId = ulid()
  const stub = {
    redeemSignInCode: async (input: { code: string }) => {
      calls.redeem.push(input)
      if (input.code !== 'good-code') return null
      return {
        user: { id: personId, name: 'Pat', email: `${personId}@client.test`, emailVerified: true, image: null },
        parentSessionId,
        parentExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        platformSuperAdmin: opts.psa ?? false,
      }
    },
    sessionStatus: async (input: unknown) => {
      calls.status.push(input)
      return { alive: opts.alive ? opts.alive() : true, expiresAt: null, platformSuperAdmin: false }
    },
    endSession: async (input: unknown) => {
      calls.end.push(input)
      return { ended: true }
    },
  }
  return { stub, calls, personId, parentSessionId }
}

/** Runs start → callback on the pool's site; returns the site-session cookie (or null). */
async function signInOnPool(cp: ReturnType<typeof fakeControlPlane>, code = 'good-code'): Promise<string | null> {
  const start = createMockEvent({ siteId: POOL_SITE, headers: { host: 'client.example' }, query: { return_to: '/admin' } }) as MockEvent
  await (startHandler as Handler)(withEnv(start, { CONTROL_PLANE: cp.stub }))
  const stateCookie = start._cookies.nuxflow_auth_state!
  const { state } = JSON.parse(stateCookie) as { state: string }
  const callback = createMockEvent({
    siteId: POOL_SITE,
    headers: { host: 'client.example' },
    query: { code, state },
    cookies: { nuxflow_auth_state: stateCookie },
  }) as MockEvent
  await (callbackHandler as Handler)(withEnv(callback, { CONTROL_PLANE: cp.stub }))
  return callback._cookies[siteSessionCookieName()] ?? null
}

function onPoolSite(cookie: string, cp: ReturnType<typeof fakeControlPlane>): H3Event {
  return withEnv(createMockEvent({ siteId: POOL_SITE, headers: { host: 'client.example' }, cookies: { [siteSessionCookieName()]: cookie } }) as MockEvent, { CONTROL_PLANE: cp.stub })
}

describe('pool: signing in through the control plane', () => {
  it('signs in with a code the control plane accepts, keeping a copy of the person', async () => {
    setMode('clientx')
    const cp = fakeControlPlane()
    const cookie = await signInOnPool(cp)
    expect(cookie).toBeTruthy()
    expect(cp.calls.redeem).toEqual([{ protocol: POOL_PROTOCOL, poolId: 'clientx', code: 'good-code', siteId: POOL_SITE, redirectUri: siteCallbackUrl('client.example') }])
    const session = await getSiteSession(onPoolSite(cookie!, cp))
    expect(session?.user).toMatchObject({ id: cp.personId, name: 'Pat', emailVerified: true })
    // The stand-in for the control plane's sign-in, which the site session hangs off.
    const [standIn] = await getCurrentTestDb().select().from(sessions).where(eq(sessions.id, cp.parentSessionId))
    expect(standIn?.token).toMatch(/^pool-standin:/)
  })

  it('refuses a code the control plane doesn\'t accept', async () => {
    setMode('clientx')
    const cp = fakeControlPlane()
    expect(await signInOnPool(cp, 'stolen-code')).toBeNull()
  })

  it('makes the platform\'s super admin a super admin here, and takes it away again', async () => {
    setMode('clientx')
    const cp = fakeControlPlane({ psa: true })
    await signInOnPool(cp)
    const roleOf = async () => (await getCurrentTestDb().select({ role: userSiteRoles.role }).from(userSiteRoles)
      .where(and(eq(userSiteRoles.userId, cp.personId), eq(userSiteRoles.siteId, POOL_SITE))))[0]?.role
    expect(await roleOf()).toBe('super_admin')

    const again = { ...cp, stub: { ...cp.stub, redeemSignInCode: async (i: { code: string }) => ({ ...(await cp.stub.redeemSignInCode(i))!, platformSuperAdmin: false }) } }
    await signInOnPool(again)
    expect(await roleOf()).toBeUndefined()
  })

  it('stops honouring the site session once the control plane says the sign-in ended', async () => {
    setMode('clientx')
    let alive = true
    const cp = fakeControlPlane({ alive: () => alive })
    const cookie = (await signInOnPool(cp))!
    expect(await getSiteSession(onPoolSite(cookie, cp))).not.toBeNull()
    // Within the minute it trusts its last answer…
    alive = false
    expect(await getSiteSession(onPoolSite(cookie, cp))).not.toBeNull()
    // …then asks again, and the stand-in and site session go.
    resetPoolSessionState()
    expect(await getSiteSession(onPoolSite(cookie, cp))).toBeNull()
    expect(await getCurrentTestDb().select().from(siteSessions).where(eq(siteSessions.parentSessionId, cp.parentSessionId))).toEqual([])
  })

  it('keeps a recently confirmed sign-in through a control-plane outage, but not an unconfirmed one', async () => {
    setMode('clientx')
    const cp = fakeControlPlane()
    await signInOnPool(cp)
    const down = { ...cp.stub, sessionStatus: async () => { throw new Error('unreachable') } }
    const event = withEnv(createMockEvent({ siteId: POOL_SITE }) as MockEvent, { CONTROL_PLANE: down })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await parentSessionAlive(event, { parentSessionId: cp.parentSessionId, userId: cp.personId, extendTo: 'x' })).toBe(true)
    resetPoolSessionState()
    expect(await parentSessionAlive(event, { parentSessionId: cp.parentSessionId, userId: cp.personId })).toBe(false)
    vi.mocked(console.error).mockRestore()
  })

  it('signing out on a pool site ends the sign-in on the control plane too', async () => {
    setMode('clientx')
    const cp = fakeControlPlane()
    const cookie = (await signInOnPool(cp))!
    await (signOutHandler as Handler)(onPoolSite(cookie, cp))
    expect(cp.calls.end).toEqual([{ protocol: POOL_PROTOCOL, parentSessionId: cp.parentSessionId, userId: cp.personId }])
    expect(await getCurrentTestDb().select().from(sessions).where(eq(sessions.id, cp.parentSessionId))).toEqual([])
  })
})

// ── The accounts origin, for a site in a pool ─────────────────────────────────────────

describe('accounts origin: a site that lives in a pool', () => {
  const branding = { id: 'remote-site', name: 'Remote', domain: 'remote.example', origin: 'https://remote.example', logoUrl: null, primaryColor: null, allowRegistration: true }

  function fakePool() {
    const joined: unknown[] = []
    const stub = {
      siteForAccounts: async (input: { siteId: string; userId: string | null }) =>
        input.siteId === 'remote-site' ? { site: branding, role: input.userId === editorId ? 'editor' : null } : null,
      joinSite: async (input: unknown) => { joined.push(input); return { joined: true } },
      userSites: async () => [{ id: 'remote-site', name: 'Remote', domain: 'remote.example', role: 'editor', origin: 'https://remote.example' }],
    }
    return { stub, joined }
  }

  async function onAccounts(userId: string, body?: unknown) {
    return createMockEvent({
      siteId: undefined,
      method: body ? 'POST' : 'GET',
      headers: { host: 'accounts.platform.test' },
      session: { user: { id: userId, name: 'Edie', email: 'editor@client.test', emailVerified: true }, session: { id: editorSession } } as never,
      body,
      query: body ? undefined : { site: 'remote-site' },
    }) as MockEvent
  }

  beforeAll(async () => {
    await getCurrentTestDb().insert(siteDirectory).values({ hostname: 'remote.example', poolId: 'remote', poolSiteId: 'remote-site' })
  })

  it('finds it through the directory and asks its pool', async () => {
    const pool = fakePool()
    const found = await findSiteForAccounts(withEnv(await onAccounts(editorId), { POOL_REMOTE: pool.stub }), 'remote-site', editorId)
    expect(found).toEqual({ site: branding, role: 'editor', poolId: 'remote' })
  })

  it('shows the authorize page for it, with the person\'s membership', async () => {
    const pool = fakePool()
    const res = await (authorizeGet as Handler)(withEnv(await onAccounts(editorId), { POOL_REMOTE: pool.stub })) as { site: { name: string }; isMember: boolean }
    expect(res.site.name).toBe('Remote')
    expect(res.isMember).toBe(true)
  })

  it('hands off to the pool\'s own domain, asking the pool to add a new member', async () => {
    const pool = fakePool()
    const event = withEnv(await onAccounts(editorId, { site: 'remote-site', state: 'x'.repeat(20), join: true }), { POOL_REMOTE: pool.stub })
    const { redirect } = await (authorizePost as Handler)(event) as { redirect: string }
    expect(new URL(redirect).origin).toBe('https://remote.example')
    expect(pool.joined).toEqual([expect.objectContaining({ siteId: 'remote-site', user: expect.objectContaining({ id: editorId }), platformOperator: false })])
  })

  it('is unavailable when its pool isn\'t bound here', async () => {
    expect(await findSiteForAccounts(withEnv(await onAccounts(editorId), {}), 'remote-site', editorId)).toBeNull()
  })

  it('lists the person\'s pool sites on the accounts home page', async () => {
    const pool = fakePool()
    const sitesList = await listUserSites(withEnv(await onAccounts(editorId), { POOL_REMOTE: pool.stub }), editorId)
    expect(sitesList.map(s => s.domain)).toContain('remote.example')
  })
})

describe('pool: answering the accounts origin', () => {
  it('describes its site, and adds a new member with a copy of the person', async () => {
    setMode('clientx')
    const event = createMockEvent({ siteId: POOL_SITE }) as unknown as H3Event
    expect(await poolSiteForAccounts(event, { protocol: POOL_PROTOCOL, siteId: POOL_SITE, userId: null }))
      .toMatchObject({ site: { name: 'Client', domain: 'client.example', allowRegistration: true }, role: null })

    const newcomer = { id: `newcomer-${ulid()}`, name: 'Nia', email: 'nia@client.test', emailVerified: false, image: null }
    expect(await poolJoinSite(event, { protocol: POOL_PROTOCOL, siteId: POOL_SITE, user: newcomer, platformOperator: false })).toEqual({ joined: true })
    expect((await getCurrentTestDb().select().from(users).where(eq(users.id, newcomer.id)))[0]?.email).toBe('nia@client.test')
    expect((await poolSiteForAccounts(event, { protocol: POOL_PROTOCOL, siteId: POOL_SITE, userId: newcomer.id }))!.role).toBe('member')
  })

  it('refuses new members when its site doesn\'t accept them', async () => {
    setMode('clientx')
    await seedSetting(getCurrentTestDb(), PRIMARY, 'auth.allow_public_registration', 'false')
    const event = createMockEvent({ siteId: PRIMARY }) as unknown as H3Event
    const person = { id: `nope-${ulid()}`, name: 'N', email: `${ulid()}@x.test`, emailVerified: false, image: null }
    await expect(poolJoinSite(event, { protocol: POOL_PROTOCOL, siteId: PRIMARY, user: person, platformOperator: false })).rejects.toMatchObject({ statusCode: 403 })
  })
})
