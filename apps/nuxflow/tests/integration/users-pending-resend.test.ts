/**
 * Coverage for:
 *  - GET /api/v1/users' `pending` flag (no session and an unverified email — accepting an
 *    invite verifies the email, and signing out deletes the session).
 *  - POST /api/v1/users/:id/resend-invite (re-sends the set-password email).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { sessions } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import listHandler from '../../server/api/v1/users/index.get'
import resendHandler from '../../server/api/v1/users/[id]/resend-invite.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const mockRequestPasswordReset = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({
    api: { requestPasswordReset: mockRequestPasswordReset },
  }),
}))

const SITE = 'site-pending-resend-01'
let adminId: string
let activeUserId: string // has signed in at least once
let pendingUserId: string // never signed in
let signedOutUserId: string // accepted, then signed out

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(callerId: string, targetId?: string) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: callerId, name: 'Test', email: 'test@pending-resend.test' } },
    params: targetId ? { id: targetId } : undefined,
  }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'pending-resend.localhost' })
  adminId = await seedUser(db, { email: 'admin@pending-resend.test' })
  await seedRole(db, adminId, SITE, 'admin')

  activeUserId = await seedUser(db, { email: 'active@pending-resend.test' })
  await seedRole(db, activeUserId, SITE, 'editor')
  await db.insert(sessions).values({
    id: ulid(),
    token: ulid(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    userId: activeUserId,
  })

  pendingUserId = await seedUser(db, { email: 'pending@pending-resend.test', emailVerified: false })
  await seedRole(db, pendingUserId, SITE, 'editor')

  // Accepted their invite (verified email), then signed out — no session row left.
  signedOutUserId = await seedUser(db, { email: 'signed-out@pending-resend.test', emailVerified: true })
  await seedRole(db, signedOutUserId, SITE, 'author')
})

afterAll(teardownTestDb)

describe('GET /api/v1/users — pending flag', () => {
  it('marks a user with no session as pending, and one with a session as not', async () => {
    const result = await (listHandler as HandlerFn)(mkEvent(adminId)) as {
      users: { id: string; pending: boolean }[]
    }
    const active = result.users.find(u => u.id === activeUserId)
    const pending = result.users.find(u => u.id === pendingUserId)

    expect(active?.pending).toBe(false)
    expect(pending?.pending).toBe(true)
  })

  it('does not mark a member who accepted and then signed out as pending', async () => {
    const result = await (listHandler as HandlerFn)(mkEvent(adminId)) as { users: { id: string; pending: boolean }[] }
    expect(result.users.find(u => u.id === signedOutUserId)?.pending).toBe(false)
  })
})

describe('POST /api/v1/users/:id/resend-invite', () => {
  it('rejects a non-admin caller', async () => {
    await expect(
      (resendHandler as HandlerFn)(mkEvent(pendingUserId, pendingUserId)),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('404s for a user not on this site', async () => {
    await expect(
      (resendHandler as HandlerFn)(mkEvent(adminId, 'nonexistent-user-id')),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses to resend to a member who already accepted, even with no live session', async () => {
    await expect(
      (resendHandler as HandlerFn)(mkEvent(adminId, signedOutUserId)),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('re-triggers the set-password email for a pending user', async () => {
    const result = await (resendHandler as HandlerFn)(mkEvent(adminId, pendingUserId)) as { success: boolean }
    expect(result.success).toBe(true)
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({
      body: { email: 'pending@pending-resend.test', redirectTo: `/reset-password?${new URLSearchParams({ site: SITE, purpose: 'invite' })}` },
    })
  })
})
