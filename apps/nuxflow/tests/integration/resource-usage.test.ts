/**
 * Integration tests for the Cloudflare resource-usage pass:
 *   - getAuthSession() answers "no session" without building Better Auth when the
 *     request carries no session cookie
 *   - getSignInCaptcha() / GET /api/v1/auth/captcha — the opt-in sign-in Turnstile
 *   - the publish-scheduled cron query is served by an index, not a table scan
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedSetting } from '../helpers/seed'
import { getAuthSession, hasBetterAuthSessionCookie } from '../../server/utils/auth'
import { getSignInCaptcha } from '../../server/utils/sign-in-captcha'
import { clearSiteInfoCache } from '../../server/utils/site-info'
import captchaHandler from '../../server/api/v1/auth/captcha.get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const PRIMARY = 'site-resource-primary'
const TENANT = 'site-resource-tenant'
type Handler = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'primary.localhost', isPrimary: true })
  await seedSite(db, { id: TENANT, domain: 'tenant.localhost' })
})

afterAll(teardownTestDb)

afterEach(() => {
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
  clearSiteInfoCache()
})

describe('getAuthSession without a session cookie', () => {
  it('recognises Better Auth session cookies, with or without the __Secure- prefix', () => {
    const ev = (cookies: Record<string, string>) => createMockEvent({ siteId: PRIMARY, cookies }) as unknown as H3Event
    expect(hasBetterAuthSessionCookie(ev({ 'better-auth.session_token': 'x' }))).toBe(true)
    expect(hasBetterAuthSessionCookie(ev({ '__Secure-better-auth.session_token': 'x' }))).toBe(true)
    expect(hasBetterAuthSessionCookie(ev({ _ga: 'GA1.1', nuxflow_consent: '{}' }))).toBe(false)
    expect(hasBetterAuthSessionCookie(ev({}))).toBe(false)
  })

  it('returns null without building the Better Auth instance', async () => {
    const getOrCreate = vi.fn()
    ;(globalThis as Record<string, unknown>).getOrCreateBetterAuth = getOrCreate

    const session = await getAuthSession(createMockEvent({ siteId: PRIMARY, cookies: { _ga: 'GA1.1' } }) as unknown as H3Event)
    expect(session).toBeNull()
    expect(getOrCreate).not.toHaveBeenCalled()
  })

  it('still asks Better Auth when a session cookie is present', async () => {
    const getSession = vi.fn().mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } })
    const getOrCreate = vi.fn().mockResolvedValue({ api: { getSession } })
    ;(globalThis as Record<string, unknown>).getOrCreateBetterAuth = getOrCreate

    const session = await getAuthSession(createMockEvent({
      siteId: PRIMARY,
      cookies: { '__Secure-better-auth.session_token': 'token.signature' },
    }) as unknown as H3Event)
    expect(getOrCreate).toHaveBeenCalledOnce()
    expect(session).toEqual({ user: { id: 'u1' }, session: { id: 's1' } })
  })
})

describe('sign-in Turnstile (getSignInCaptcha)', () => {
  const ev = (siteId = PRIMARY) => createMockEvent({ siteId }) as unknown as H3Event

  it('is off until the secret, the primary site key and the switch are all set', async () => {
    const db = getCurrentTestDb()
    expect(await getSignInCaptcha(ev())).toBeNull()

    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'secret-key'
    await seedSetting(db, PRIMARY, 'integrations.turnstile_site_key', '0x4AAA-site-key')
    // Site key + secret alone isn't enough: the switch is what protects an operator whose
    // widget doesn't list the sign-in hostname from locking everyone out.
    expect(await getSignInCaptcha(ev())).toBeNull()

    await seedSetting(db, PRIMARY, 'auth.turnstile_sign_in', 'true')
    expect(await getSignInCaptcha(ev())).toEqual({ siteKey: '0x4AAA-site-key', secretKey: 'secret-key' })
  })

  it('always uses the primary site\'s configuration, whichever site the request is on', async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'secret-key'
    await seedSetting(getCurrentTestDb(), TENANT, 'integrations.turnstile_site_key', '0x4AAA-tenant-key')
    expect(await getSignInCaptcha(ev(TENANT))).toEqual({ siteKey: '0x4AAA-site-key', secretKey: 'secret-key' })
  })

  it('the captcha endpoint exposes the site key only — never the secret', async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'secret-key'
    expect(await (captchaHandler as Handler)(ev())).toEqual({ siteKey: '0x4AAA-site-key' })

    delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
    expect(await (captchaHandler as Handler)(ev())).toEqual({ siteKey: null })
  })
})

describe('publish-scheduled cron query', () => {
  it('uses the partial scheduled index instead of scanning content_items', async () => {
    const plan = await getCurrentTestDb().all<{ detail: string }>(sql`
      EXPLAIN QUERY PLAN
      SELECT id FROM content_items
      WHERE status = 'scheduled' AND scheduled_at <= datetime('now')
    `)
    const details = plan.map(row => row.detail).join(' | ')
    expect(details).toContain('idx_content_items_scheduled')
    expect(details).not.toMatch(/SCAN content_items(?! USING)/)
  })
})
