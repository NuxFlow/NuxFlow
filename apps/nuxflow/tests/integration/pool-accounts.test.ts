/**
 * Account-wide work with member pools (Phase 4b): inviting people to a pool's site — the
 * account is made, and the set-password email sent, by the control plane
 * (user-provisioning.ts, pool-sign-in.ts) — and deleting / exporting an account, which
 * reaches every pool (account-data.ts). Each side's binding to the other is faked as a
 * plain object in the Cloudflare env; both sides share this one test database.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { siteDirectory, siteInvitations, userSiteRoles, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))
const mockSendEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/email-template', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sendTemplatedEmail: (...args: unknown[]) => mockSendEmail(...args) }
})
const mockRequestPasswordReset = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({
    $context: Promise.resolve({
      internalAdapter: {
        createUser: async (data: { name: string; email: string; emailVerified: boolean }) => {
          const id = ulid()
          await getCurrentTestDb().insert(users).values({ id, ...data })
          return { id, ...data }
        },
      },
    }),
    api: {
      requestPasswordReset: mockRequestPasswordReset,
      signOut: async () => new Response(null),
    },
  }),
  clearBetterAuthCache: vi.fn(),
}))

const ACCOUNTS = 'https://accounts.platform.test'
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { provisionAccount, sendSetPasswordEmailForPool } = await import('../../server/utils/pool-sign-in')
const { signInThroughControlPlane } = await import('../../server/utils/pool-session')
const { poolAccountDeletionCheck, poolDeleteAccount, poolExportUserData } = await import('../../server/utils/account-data')
const { default: inviteHandler } = await import('../../server/api/v1/users/index.post')
const { default: deleteAccountHandler } = await import('../../server/api/v1/account/index.delete')
const { default: exportHandler } = await import('../../server/api/v1/account/data-export.get')

type Handler = (e: H3Event) => Promise<unknown>
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }
type Config = Record<string, unknown> & { public: Record<string, unknown> }
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

function setMode(poolId: string | null) {
  g.useRuntimeConfig = () => {
    const base = baseConfig()
    return { ...base, poolId: poolId ?? '', public: { ...base.public, accountsUrl: ACCOUNTS } }
  }
}
function withEnv(event: MockEvent, env: Record<string, unknown>): H3Event {
  event.context.cloudflare = { env, context: { waitUntil: () => {} } }
  // The accounts origin has no site; createMockEvent fills in a placeholder id otherwise.
  if (event.context.siteId === undefined || event.context.siteId === 'site-test-01') event.context.siteId = null
  return event as unknown as H3Event
}

const PRIMARY = 'site-acct-primary'
const POOL_SITE = 'site-acct-pool'
let poolAdminId: string

beforeAll(async () => {
  setMode(null)
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, setupCompleted: true })
  await seedSite(db, { id: POOL_SITE, name: 'Client', domain: 'client.example', setupCompleted: true })
  await db.insert(siteDirectory).values({ hostname: 'client.example', poolId: 'clientx', poolSiteId: POOL_SITE })
  poolAdminId = await seedUser(db, { email: 'boss@client.test', name: 'Boss' })
  await seedRole(db, poolAdminId, POOL_SITE, 'admin')
})
afterAll(async () => {
  g.useRuntimeConfig = baseConfig
  await teardownTestDb()
})
beforeEach(() => {
  mockSendEmail.mockClear()
  mockRequestPasswordReset.mockClear()
})
afterEach(() => setMode(null))

// ── Inviting people to a pool's site ─────────────────────────────────────────────────

/** A fake CONTROL_PLANE binding answering invites with the given account. */
function fakeControlPlane(account: { id: string; email: string; emailVerified?: boolean }, status: 'new' | 'existing' | 'unclaimed', emailDelivery: unknown = { sent: true }) {
  const calls = { provision: [] as unknown[], email: [] as unknown[] }
  return {
    calls,
    stub: {
      provisionAccount: async (input: unknown) => {
        calls.provision.push(input)
        return { user: { id: account.id, name: 'Invitee', email: account.email, emailVerified: account.emailVerified ?? false, image: null }, status }
      },
      sendSetPasswordEmail: async (input: unknown) => {
        calls.email.push(input)
        return { emailDelivery }
      },
    },
  }
}

function inviteOnPool(cp: ReturnType<typeof fakeControlPlane>, email: string, role = 'editor') {
  return (inviteHandler as Handler)(withEnv(createMockEvent({
    siteId: POOL_SITE,
    session: { user: { id: poolAdminId, name: 'Boss', email: 'boss@client.test' } },
    body: { name: 'Invitee', email, role },
  }) as MockEvent, { CONTROL_PLANE: cp.stub }))
}

describe('inviting someone to a pool\'s site', () => {
  it('has the control plane make the account and send the set-password email', async () => {
    setMode('clientx')
    const newcomer = { id: `new-${ulid()}`, email: 'newcomer@client.test' }
    const cp = fakeControlPlane(newcomer, 'new')
    const res = await inviteOnPool(cp, 'Newcomer@Client.test') as { id: string; emailDelivery: unknown }

    expect(cp.calls.provision).toEqual([{ protocol: POOL_PROTOCOL, poolId: 'clientx', siteId: POOL_SITE, name: 'Invitee', email: 'Newcomer@Client.test' }])
    expect(cp.calls.email).toEqual([{ protocol: POOL_PROTOCOL, poolId: 'clientx', siteId: POOL_SITE, email: 'newcomer@client.test', purpose: 'invite' }])
    expect(res).toMatchObject({ id: newcomer.id, emailDelivery: { sent: true } })
    // The pool's copy of the person, and their role here.
    const db = getCurrentTestDb()
    expect((await db.select().from(users).where(eq(users.id, newcomer.id)))[0]?.email).toBe('newcomer@client.test')
    expect((await db.select().from(userSiteRoles).where(and(eq(userSiteRoles.userId, newcomer.id), eq(userSiteRoles.siteId, POOL_SITE))))[0]?.role).toBe('editor')
    // Never the pool's own (absent) Better Auth.
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('holds a pending invitation for an account nobody has proven they own', async () => {
    setMode('clientx')
    const squat = { id: `squat-${ulid()}`, email: 'squatted@client.test' }
    const cp = fakeControlPlane(squat, 'unclaimed')
    const res = await inviteOnPool(cp, squat.email) as { pending?: boolean }
    expect(res.pending).toBe(true)
    const db = getCurrentTestDb()
    expect(await db.select().from(userSiteRoles).where(eq(userSiteRoles.userId, squat.id))).toEqual([])
    expect(await db.select().from(siteInvitations).where(eq(siteInvitations.userId, squat.id))).toHaveLength(1)
    expect(cp.calls.email).toHaveLength(1)
  })

  it('…and turns it into a role once they sign in with a verified address', async () => {
    setMode('clientx')
    const person = { id: `claim-${ulid()}`, email: 'claimer@client.test' }
    await inviteOnPool(fakeControlPlane(person, 'unclaimed'), person.email)
    const signIn = {
      redeemSignInCode: async () => ({
        user: { id: person.id, name: 'Claimer', email: person.email, emailVerified: true, image: null },
        parentSessionId: ulid(),
        parentExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        platformSuperAdmin: false,
      }),
    }
    const event = withEnv(createMockEvent({ siteId: POOL_SITE }) as MockEvent, { CONTROL_PLANE: signIn })
    await signInThroughControlPlane(event, { code: 'c', siteId: POOL_SITE, redirectUri: 'https://client.example/_nuxflow/auth/callback' })
    const db = getCurrentTestDb()
    expect((await db.select().from(userSiteRoles).where(eq(userSiteRoles.userId, person.id)))[0]?.role).toBe('editor')
  })

  it('treats an account with a staff role in this pool as claimed, even if the control plane can\'t tell', async () => {
    setMode('clientx')
    const db = getCurrentTestDb()
    const staff = await seedUser(db, { email: 'staff@client.test' })
    await seedRole(db, staff, PRIMARY, 'editor')
    const cp = fakeControlPlane({ id: staff, email: 'staff@client.test' }, 'unclaimed')
    const res = await inviteOnPool(cp, 'staff@client.test') as { pending?: boolean }
    expect(res.pending).toBeUndefined()
    expect(mockSendEmail).toHaveBeenCalled() // "You've been added", sent by the pool itself
    expect(cp.calls.email).toEqual([])
  })

  it('reports a set-password email the control plane couldn\'t send', async () => {
    setMode('clientx')
    const person = { id: `nomail-${ulid()}`, email: 'nomail@client.test' }
    const cp = fakeControlPlane(person, 'new')
    const broken = { ...cp.stub, sendSetPasswordEmail: async () => { throw new Error('down') } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (inviteHandler as Handler)(withEnv(createMockEvent({
      siteId: POOL_SITE,
      session: { user: { id: poolAdminId, name: 'Boss', email: 'boss@client.test' } },
      body: { name: 'Invitee', email: person.email, role: 'author' },
    }) as MockEvent, { CONTROL_PLANE: broken })) as { emailDelivery: { sent: boolean } }
    vi.mocked(console.error).mockRestore()
    expect(res.emailDelivery.sent).toBe(false)
  })
})

describe('the control plane\'s side of invites', () => {
  const cpEvent = () => createMockEvent({ siteId: undefined }) as unknown as H3Event

  it('makes the account for a site the calling pool serves', async () => {
    const res = await provisionAccount(cpEvent(), { protocol: POOL_PROTOCOL, poolId: 'clientx', siteId: POOL_SITE, name: 'Fresh', email: 'Fresh@Client.test' })
    expect(res).toMatchObject({ status: 'new', user: { email: 'fresh@client.test', emailVerified: false } })
  })

  it('refuses a site the calling pool doesn\'t serve', async () => {
    await expect(provisionAccount(cpEvent(), { protocol: POOL_PROTOCOL, poolId: 'otherpool', siteId: POOL_SITE, name: 'X', email: 'x@x.test' }))
      .rejects.toThrow(/isn't in the calling pool/)
    await expect(sendSetPasswordEmailForPool(cpEvent(), { protocol: POOL_PROTOCOL, poolId: 'otherpool', siteId: POOL_SITE, email: 'x@x.test', purpose: 'invite' }))
      .rejects.toThrow(/isn't in the calling pool/)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('sends the set-password email, pointing back at the pool\'s site', async () => {
    await sendSetPasswordEmailForPool(cpEvent(), { protocol: POOL_PROTOCOL, poolId: 'clientx', siteId: POOL_SITE, email: 'fresh@client.test', purpose: 'invite' })
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({ body: { email: 'fresh@client.test', redirectTo: `/reset-password?site=${POOL_SITE}&purpose=invite` } })
  })
})

// ── Deleting and exporting an account across pools ───────────────────────────────────

describe('deleting an account', () => {
  async function accountEvent(userId: string, pools: Record<string, unknown>) {
    return withEnv(createMockEvent({
      siteId: undefined,
      method: 'DELETE',
      headers: { host: 'accounts.platform.test' },
      session: { user: { id: userId, name: 'U', email: `${userId}@x.test` } },
    }) as MockEvent, pools)
  }
  const pool = (over: Record<string, unknown> = {}) => {
    const deleted: string[] = []
    return {
      deleted,
      stub: {
        accountDeletionCheck: async () => ({ soleAdminDomains: [] as string[] }),
        deleteAccount: async ({ userId }: { userId: string }) => { deleted.push(userId); return { deleted: true } },
        ...over,
      },
    }
  }
  const exists = async (id: string) => (await getCurrentTestDb().select().from(users).where(eq(users.id, id))).length === 1

  it('is refused while they\'re the only admin of a site in a pool', async () => {
    const id = await seedUser(getCurrentTestDb(), { email: `${ulid()}@x.test` })
    const p = pool({ accountDeletionCheck: async () => ({ soleAdminDomains: ['client.example'] }) })
    await expect((deleteAccountHandler as Handler)(await accountEvent(id, { POOL_A: p.stub })))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('client.example') })
    expect(await exists(id)).toBe(true)
  })

  it('is refused, deleting nothing, while a pool can\'t be reached', async () => {
    const id = await seedUser(getCurrentTestDb(), { email: `${ulid()}@x.test` })
    const p = pool({ accountDeletionCheck: async () => { throw new Error('asleep') } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect((deleteAccountHandler as Handler)(await accountEvent(id, { POOL_A: p.stub }))).rejects.toMatchObject({ statusCode: 503 })
    vi.mocked(console.error).mockRestore()
    expect(await exists(id)).toBe(true)
  })

  it('erases them from every pool before deleting the account here', async () => {
    const id = await seedUser(getCurrentTestDb(), { email: `${ulid()}@x.test` })
    const a = pool()
    const b = pool()
    await (deleteAccountHandler as Handler)(await accountEvent(id, { POOL_A: a.stub, POOL_B: b.stub }))
    expect(a.deleted).toEqual([id])
    expect(b.deleted).toEqual([id])
    expect(await exists(id)).toBe(false)
  })

  it('keeps the account when a pool fails to erase, so it can be tried again', async () => {
    const id = await seedUser(getCurrentTestDb(), { email: `${ulid()}@x.test` })
    const p = pool({ deleteAccount: async () => { throw new Error('payment provider said no') } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect((deleteAccountHandler as Handler)(await accountEvent(id, { POOL_A: p.stub }))).rejects.toMatchObject({ statusCode: 502 })
    vi.mocked(console.error).mockRestore()
    expect(await exists(id)).toBe(true)
  })
})

describe('a pool\'s side of account deletion and export', () => {
  it('names sites where the person is the only admin, erases its copy, and is safe to repeat', async () => {
    setMode('clientx')
    const db = getCurrentTestDb()
    const solo = await seedUser(db, { email: `${ulid()}@solo.test` })
    const soloSite = `site-solo-${ulid()}`
    await seedSite(db, { id: soloSite, domain: `${soloSite}.example` })
    await seedRole(db, solo, soloSite, 'admin')
    const event = createMockEvent({ siteId: undefined }) as unknown as H3Event
    expect(await poolAccountDeletionCheck(event, { protocol: POOL_PROTOCOL, userId: solo })).toEqual({ soleAdminDomains: [`${soloSite}.example`] })

    expect(await poolExportUserData(event, { protocol: POOL_PROTOCOL, userId: solo })).toMatchObject({ siteRoles: [{ siteDomain: `${soloSite}.example`, role: 'admin' }] })
    expect(await poolDeleteAccount(event, { protocol: POOL_PROTOCOL, userId: solo })).toEqual({ deleted: true })
    expect(await db.select().from(users).where(eq(users.id, solo))).toEqual([])
    expect(await poolDeleteAccount(event, { protocol: POOL_PROTOCOL, userId: solo })).toEqual({ deleted: false })
  })
})

describe('downloading your data', () => {
  it('includes what each pool holds, and names any pool that couldn\'t be reached', async () => {
    const id = await seedUser(getCurrentTestDb(), { email: `${ulid()}@export.test` })
    const poolPart = {
      siteRoles: [{ siteId: 'pool-site', role: 'editor', createdAt: '', siteName: 'Pool site', siteDomain: 'pool.example' }],
      authoredContent: [], authoredContentTruncated: false, authoredRevisions: [], authoredRevisionsTruncated: false,
      uploadedMedia: [], uploadedMediaTruncated: true, comments: [], commentsTruncated: false,
      formSubmissions: [], formSubmissionsTruncated: false, subscriptions: [], apiKeys: [], auditLog: [], auditLogTruncated: false,
    }
    const event = withEnv(createMockEvent({
      siteId: undefined,
      headers: { host: 'accounts.platform.test' },
      session: { user: { id, name: 'U', email: 'u@export.test' } },
    }) as MockEvent, {
      POOL_A: { exportUserData: async () => poolPart },
      POOL_DOWN: { exportUserData: async () => { throw new Error('asleep') } },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (exportHandler as Handler)(event) as Record<string, unknown>
    vi.mocked(console.error).mockRestore()
    expect(res.siteRoles).toEqual([expect.objectContaining({ siteDomain: 'pool.example' })])
    expect(res.uploadedMediaTruncated).toBe(true)
    expect(res.incompleteFrom).toEqual(['POOL_DOWN'])
  })
})
