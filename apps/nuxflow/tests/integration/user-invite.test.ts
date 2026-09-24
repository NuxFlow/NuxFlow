import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { accounts, passkeys, sessions, userSiteRoles, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const mockSendEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/email', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sendEmail: (...args: unknown[]) => mockSendEmail(...args) }
})

// Argon2 at production cost is slow and irrelevant to what's under test here.
vi.mock('../../server/utils/pw', () => ({
  nuxflowPasswordHasher: {
    hash: async (password: string) => `hashed:${password}`,
    verify: async ({ hash, password }: { hash: string; password: string }) => hash === `hashed:${password}`,
  },
}))

const mockRequestPasswordReset = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({
    api: {
      signUpEmail: async ({ body }: { body: { name: string; email: string } }) => {
        await getCurrentTestDb().insert(users).values({ id: ulid(), name: body.name, email: body.email, emailVerified: false })
      },
      requestPasswordReset: mockRequestPasswordReset,
    },
  }),
  clearBetterAuthCache: vi.fn(),
}))

const { default: inviteHandler } = await import('../../server/api/v1/users/index.post')

const SITE = 'site-invite-01'
const OTHER_SITE = 'site-invite-02'
let adminId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'invite.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'invite2.localhost' })
  adminId = await seedUser(db, { email: 'admin@invite.test', name: 'Admin' })
  await seedRole(db, adminId, SITE, 'admin')
})
afterAll(teardownTestDb)
beforeEach(() => {
  mockRequestPasswordReset.mockClear()
  mockSendEmail.mockClear()
})

type Handler = (e: H3Event) => Promise<unknown>

function invite(email: string, role = 'admin') {
  return (inviteHandler as Handler)(createMockEvent({
    siteId: SITE,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@invite.test' } },
    body: { name: 'Invitee', email, role },
  }) as unknown as H3Event)
}

/** An account someone registered for an address, with a password and passkey they control. */
async function seedPreRegistered(email: string, opts: { emailVerified?: boolean } = {}) {
  const db = getCurrentTestDb()
  const id = await seedUser(db, { email, name: 'Squatter', emailVerified: opts.emailVerified ?? false })
  // seedUser already created the credential account — give it a password "they" know.
  await db.update(accounts).set({ password: 'hashed:attacker-knows-this' }).where(eq(accounts.userId, id))
  await db.insert(sessions).values({
    id: ulid(), userId: id, token: `tok-${id}`, expiresAt: new Date(Date.now() + 86_400_000),
  } as typeof sessions.$inferInsert)
  await db.insert(passkeys).values({
    id: ulid(), userId: id, publicKey: 'pk', credentialID: `cred-${id}`, counter: 0, deviceType: 'singleDevice', backedUp: false,
  } as typeof passkeys.$inferInsert)
  return id
}

describe('POST /api/v1/users — inviting an address that already has an account', () => {
  // Pre-registration ("pre-hijacking"): someone creates an account for a colleague's
  // address before the colleague is invited. The invite must not attach its role to an
  // account whose creator never proved they own the mailbox.
  it('reclaims an unverified, never-vouched-for account before granting the role', async () => {
    const db = getCurrentTestDb()
    const squatterId = await seedPreRegistered('new-hire@invite.test')

    await invite('new-hire@invite.test')

    const cred = await db.query.accounts.findFirst({ where: eq(accounts.userId, squatterId) })
    expect(cred!.password).not.toBe('hashed:attacker-knows-this')
    expect(await db.query.sessions.findMany({ where: eq(sessions.userId, squatterId) })).toHaveLength(0)
    expect(await db.query.passkeys.findMany({ where: eq(passkeys.userId, squatterId) })).toHaveLength(0)

    // The real owner claims it through the set-password email, not a "just sign in" email.
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({ body: expect.objectContaining({ email: 'new-hire@invite.test' }) })
    expect(mockSendEmail).not.toHaveBeenCalled()

    const role = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.userId, squatterId), eq(userSiteRoles.siteId, SITE)),
    })
    expect(role?.role).toBe('admin')
  })

  // Self-registration only ever grants 'member', so it doesn't count as proof either.
  it('also reclaims an unverified account that only holds a self-registered member role elsewhere', async () => {
    const db = getCurrentTestDb()
    const id = await seedPreRegistered('member-elsewhere@invite.test')
    await seedRole(db, id, OTHER_SITE, 'member')

    await invite('member-elsewhere@invite.test')

    const cred = await db.query.accounts.findFirst({ where: eq(accounts.userId, id) })
    expect(cred!.password).not.toBe('hashed:attacker-knows-this')
    expect(mockRequestPasswordReset).toHaveBeenCalled()
  })

  it('leaves a verified account untouched and just notifies it', async () => {
    const db = getCurrentTestDb()
    const id = await seedPreRegistered('verified@invite.test', { emailVerified: true })

    await invite('verified@invite.test', 'editor')

    const cred = await db.query.accounts.findFirst({ where: eq(accounts.userId, id) })
    expect(cred!.password).toBe('hashed:attacker-knows-this')
    expect(await db.query.sessions.findMany({ where: eq(sessions.userId, id) })).toHaveLength(1)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalled()
  })

  // Long-standing team accounts predate email verification (every such row is still
  // emailVerified=false), but a staff role granted by an admin already vouches for them.
  it('leaves an existing staff member on another site untouched', async () => {
    const db = getCurrentTestDb()
    const id = await seedPreRegistered('staff-elsewhere@invite.test')
    await seedRole(db, id, OTHER_SITE, 'editor')

    await invite('staff-elsewhere@invite.test', 'author')

    const cred = await db.query.accounts.findFirst({ where: eq(accounts.userId, id) })
    expect(cred!.password).toBe('hashed:attacker-knows-this')
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('does not touch an account that is already a member of this site (409 first)', async () => {
    const db = getCurrentTestDb()
    const id = await seedPreRegistered('already-here@invite.test')
    await seedRole(db, id, SITE, 'member')

    await expect(invite('already-here@invite.test')).rejects.toMatchObject({ statusCode: 409 })

    const cred = await db.query.accounts.findFirst({ where: eq(accounts.userId, id) })
    expect(cred!.password).toBe('hashed:attacker-knows-this')
  })

  it('creates a brand-new account and sends the set-password email when none exists', async () => {
    await invite('brand-new@invite.test', 'editor')
    const created = await getCurrentTestDb().query.users.findFirst({ where: eq(users.email, 'brand-new@invite.test') })
    expect(created).toBeTruthy()
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({ body: expect.objectContaining({ email: 'brand-new@invite.test' }) })
  })
})
