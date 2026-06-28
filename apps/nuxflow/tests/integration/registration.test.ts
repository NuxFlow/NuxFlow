import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { users, accounts, userSiteRoles } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser } from '../helpers/seed'
import handler from '../../server/api/public/auth/register.post'
import { resolveSetting } from '../../server/utils/settings'

vi.mock('../../server/utils/settings', () => ({
  resolveSetting: vi.fn(),
  saveSetting: vi.fn(),
  SENSITIVE_SETTING_KEYS: new Set(),
  SECRET_MASK: '••••••••••••••••',
}))

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-reg-01'
let existingUserId!: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'reg.localhost' })
  existingUserId = await seedUser(db, { email: 'existing@reg.test' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(body: unknown, siteId = SITE) {
  return createMockEvent({
    siteId,
    body,
    path: '/api/public/auth/register',
    headers: { host: 'reg.localhost' },
  }) as unknown as H3Event
}

// Suppress unused-variable warning; existingUserId retained for future tests.
void existingUserId

describe('POST /api/public/auth/register', () => {
  describe('when registration is disabled', () => {
    beforeAll(() => {
      vi.mocked(resolveSetting).mockResolvedValue('false')
    })

    it('throws 403 when public registration is not enabled', async () => {
      await expect(
        (handler as HandlerFn)(
          mkEvent({ name: 'Alice', email: 'alice@example.com', password: 'password123' }),
        ),
      ).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  describe('when registration is enabled', () => {
    beforeAll(() => {
      vi.mocked(resolveSetting).mockResolvedValue('true')
    })

    it('throws when body is invalid — missing name', async () => {
      const event = mkEvent({ email: 'alice@example.com', password: 'password123' })
      await expect((handler as HandlerFn)(event)).rejects.toBeDefined()
    })

    it('throws when body is invalid — password too short', async () => {
      const event = mkEvent({ name: 'Alice', email: 'alice@example.com', password: 'short' })
      await expect((handler as HandlerFn)(event)).rejects.toBeDefined()
    })

    it('creates the user and credential account in the DB on success', async () => {
      const email = 'newuser@reg.test'
      const result = await (handler as HandlerFn)(
        mkEvent({ name: 'New User', email, password: 'securePass9!' }),
      )

      expect(result).toEqual({ success: true })

      const db = getCurrentTestDb()
      const user = await db.query.users.findFirst({ where: eq(users.email, email) })
      expect(user).not.toBeUndefined()
      expect(user!.name).toBe('New User')

      const account = await db.query.accounts.findFirst({
        where: eq(accounts.userId, user!.id),
      })
      expect(account).not.toBeUndefined()
      expect(account!.providerId).toBe('credential')
      expect(account!.password).not.toBeNull()

      const role = await db.query.userSiteRoles.findFirst({
        where: eq(userSiteRoles.userId, user!.id),
      })
      expect(role?.role).toBe('member')
    })

    it('throws 422 when email is already registered', async () => {
      await expect(
        (handler as HandlerFn)(
          mkEvent({ name: 'Dup', email: 'existing@reg.test', password: 'password123' }),
        ),
      ).rejects.toMatchObject({ statusCode: 422 })
    })
  })
})
