/**
 * Integration tests for GET /api/v1/settings and POST /api/v1/settings/email-test.
 *
 * Behaviour under test:
 *  - Every key in SENSITIVE_SETTING_KEYS comes back masked — never the stored
 *    ciphertext, never the plaintext — whether it's set in the DB or only via env.
 *  - Settings are scoped to the current site.
 *  - email-test resolves a masked/blank key from stored settings instead of sending
 *    the literal mask string to the provider.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'
import { SENSITIVE_SETTING_KEYS, SECRET_MASK, saveSetting } from '../../server/utils/settings'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockSendEmailWithConfig } = vi.hoisted(() => ({ mockSendEmailWithConfig: vi.fn() }))
vi.mock('../../server/utils/email', () => ({ sendEmailWithConfig: mockSendEmailWithConfig }))

const { default: getSettingsHandler } = await import('../../server/api/v1/settings/index.get')
const { default: emailTestHandler } = await import('../../server/api/v1/settings/email-test.post')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-settings-read-01'
const OTHER = 'site-settings-read-02'
let adminId: string
let editorId: string

const realRuntimeConfig = globalThis.useRuntimeConfig

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'sr.localhost', name: 'Read Site' })
  await seedSite(db, { id: OTHER, domain: 'sr2.localhost' })
  adminId = await seedUser(db, { email: 'admin@sr.test' })
  editorId = await seedUser(db, { email: 'editor@sr.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
})

afterAll(teardownTestDb)
afterEach(() => {
  globalThis.useRuntimeConfig = realRuntimeConfig
  mockSendEmailWithConfig.mockReset()
})

function ev(userId: string, body?: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'U', email: 'admin@sr.test' } },
    body,
    headers: { host: 'sr.localhost:8787' },
  }) as unknown as H3Event
}

describe('GET /api/v1/settings', () => {
  it('forbids an editor', async () => {
    await expect((getSettingsHandler as Handler)(ev(editorId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('masks every sensitive key stored in the DB and passes plain keys through', async () => {
    const db = getCurrentTestDb()
    for (const key of SENSITIVE_SETTING_KEYS) await seedSetting(db, SITE, key, `ciphertext-for-${key}`)
    await seedSetting(db, SITE, 'site.tagline', 'Hello world')

    const res = await (getSettingsHandler as Handler)(ev(adminId)) as { site: { name: string }; settings: Record<string, unknown> }
    expect(res.site.name).toBe('Read Site')
    expect(res.settings['site.tagline']).toBe('Hello world')
    for (const key of SENSITIVE_SETTING_KEYS) {
      expect(res.settings[key], key).toBe(SECRET_MASK)
    }
    expect(JSON.stringify(res)).not.toContain('ciphertext-for-')
  })

  it('never leaks a real encrypted value saved through saveSetting', async () => {
    const event = ev(adminId)
    await saveSetting(event, 'ai.openai_api_key', 'sk-real-secret-value')
    const res = await (getSettingsHandler as Handler)(ev(adminId)) as { settings: Record<string, unknown> }
    expect(res.settings['ai.openai_api_key']).toBe(SECRET_MASK)
    expect(JSON.stringify(res)).not.toContain('sk-real-secret-value')
  })

  it('does not return another site\'s settings', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, OTHER, 'site.foreign_only', 'nope')
    const res = await (getSettingsHandler as Handler)(ev(adminId)) as { settings: Record<string, unknown> }
    expect(res.settings).not.toHaveProperty('site.foreign_only')
  })

  it('masks env-only secrets and surfaces non-sensitive env values as-is', async () => {
    globalThis.useRuntimeConfig = () => ({
      ...realRuntimeConfig(),
      stripeWebhookSecret: 'whsec_env_only',
      s3Bucket: 'env-bucket',
      googleClientId: 'env-google-id',
    })
    const res = await (getSettingsHandler as Handler)(ev(adminId)) as { settings: Record<string, unknown> }
    // Sensitive keys already set in the DB above stay masked; an env-only one is masked too.
    expect(res.settings['payments.stripe_webhook_secret']).toBe(SECRET_MASK)
    expect(res.settings['media.s3_bucket']).toBe('env-bucket')
    expect(res.settings['auth.google_client_id']).toBe('env-google-id')
    expect(JSON.stringify(res)).not.toContain('whsec_env_only')
  })
})

describe('POST /api/v1/settings/email-test', () => {
  it('forbids an editor', async () => {
    await expect((emailTestHandler as Handler)(ev(editorId, { provider: 'console' })))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('short-circuits the console provider without sending', async () => {
    const res = await (emailTestHandler as Handler)(ev(adminId, { provider: 'console' })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(mockSendEmailWithConfig).not.toHaveBeenCalled()
  })

  it('resolves a masked key from stored settings and defaults the recipient to the caller', async () => {
    await saveSetting(ev(adminId), 'email.resend_api_key', 're_stored_key')
    mockSendEmailWithConfig.mockResolvedValueOnce(undefined)

    const res = await (emailTestHandler as Handler)(ev(adminId, { provider: 'resend', resendApiKey: SECRET_MASK })) as { message: string }

    expect(res.message).toContain('admin@sr.test')
    const [config, msg] = mockSendEmailWithConfig.mock.calls[0]
    expect(config).toMatchObject({ emailProvider: 'resend', resendApiKey: 're_stored_key', domain: 'sr.localhost' })
    expect(msg).toMatchObject({ to: 'admin@sr.test' })
  })

  it('uses an explicitly supplied key over the stored one', async () => {
    mockSendEmailWithConfig.mockResolvedValueOnce(undefined)
    await (emailTestHandler as Handler)(ev(adminId, { provider: 'resend', resendApiKey: 're_typed_in', sendTo: 'x@example.com' }))
    expect(mockSendEmailWithConfig.mock.calls[0][0]).toMatchObject({ resendApiKey: 're_typed_in' })
    expect(mockSendEmailWithConfig.mock.calls[0][1]).toMatchObject({ to: 'x@example.com' })
  })

  it('surfaces a provider failure as a 422 with the provider\'s message', async () => {
    mockSendEmailWithConfig.mockRejectedValueOnce(new Error('Resend: invalid API key'))
    await expect((emailTestHandler as Handler)(ev(adminId, { provider: 'resend' })))
      .rejects.toMatchObject({ statusCode: 422, message: 'Resend: invalid API key' })
  })
})
