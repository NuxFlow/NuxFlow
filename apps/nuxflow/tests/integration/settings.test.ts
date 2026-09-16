import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedSetting } from '../helpers/seed'
import { resolveSetting, saveSetting, SENSITIVE_SETTING_KEYS, SECRET_MASK } from '../../server/utils/settings'
import { encryptText } from '../../server/utils/encryption'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

let siteId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  siteId = `site-settings-${Date.now()}`
  await seedSite(db, { id: siteId, domain: `settings-${Date.now()}.localhost` })
})

afterAll(teardownTestDb)

function mkEvent(id = siteId) {
  return createMockEvent({ siteId: id }) as unknown as H3Event
}

describe('saveSetting + resolveSetting', () => {
  it('saves a plain setting and retrieves it', async () => {
    const event = mkEvent()
    await saveSetting(event, 'site.name', 'My Test Site')
    const value = await resolveSetting(event, 'site.name')
    expect(value).toBe('My Test Site')
  })

  it('overwrites an existing setting', async () => {
    const event = mkEvent()
    await saveSetting(event, 'site.tagline', 'v1')
    await saveSetting(event, 'site.tagline', 'v2')
    const value = await resolveSetting(event, 'site.tagline')
    expect(value).toBe('v2')
  })

  it('deletes a setting when value is empty string', async () => {
    const delSiteId = `${siteId}-del`
    await seedSite(getCurrentTestDb(), { id: delSiteId, domain: `del-${Date.now()}.localhost` })
    const event = mkEvent(delSiteId)
    await saveSetting(event, 'site.desc.del', 'to delete')
    await saveSetting(event, 'site.desc.del', '')
    const value = await resolveSetting(event, 'site.desc.del')
    expect(value).toBe('')
  })

  it('returns empty string when a setting does not exist', async () => {
    const event = mkEvent()
    const value = await resolveSetting(event, 'nonexistent.key')
    expect(value).toBe('')
  })

  it('encrypts sensitive settings on save', async () => {
    expect(SENSITIVE_SETTING_KEYS.has('email.resend_api_key')).toBe(true)
    expect(SENSITIVE_SETTING_KEYS.has('payments.stripe_secret_key')).toBe(true)

    const encSiteId = `${siteId}-enc`
    await seedSite(getCurrentTestDb(), { id: encSiteId, domain: `enc-${Date.now()}.localhost` })
    const event = mkEvent(encSiteId)
    await saveSetting(event, 'email.resend_api_key', 'key_live_abc123')

    const retrieved = await resolveSetting(event, 'email.resend_api_key')
    expect(retrieved).toBe('key_live_abc123')
  })

  it('does not re-save when a sensitive value equals the mask', async () => {
    const maskSiteId = `${siteId}-mask`
    await seedSite(getCurrentTestDb(), { id: maskSiteId, domain: `mask-${Date.now()}.localhost` })
    const event = mkEvent(maskSiteId)
    await saveSetting(event, 'payments.stripe_secret_key', 'sk_live_original')

    await saveSetting(event, 'payments.stripe_secret_key', SECRET_MASK)

    const value = await resolveSetting(event, 'payments.stripe_secret_key')
    expect(value).toBe('sk_live_original')
  })

  it('correctly encrypts and decrypts a sensitive value via save + resolve', async () => {
    const roundTripSiteId = `${siteId}-rt`
    await seedSite(getCurrentTestDb(), { id: roundTripSiteId, domain: `rt-${Date.now()}.localhost` })
    const event = mkEvent(roundTripSiteId)
    await saveSetting(event, 'ai.openai_api_key', 'plain-key')
    const result = await resolveSetting(event, 'ai.openai_api_key')
    expect(result).toBe('plain-key')
  })

  it('throws 400 when saving without a siteId in context', async () => {
    const event = createMockEvent({ siteId: undefined as unknown as string }) as unknown as H3Event
    ;(event as unknown as { context: { siteId: string | undefined } }).context.siteId = undefined
    await expect(saveSetting(event, 'foo', 'bar')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('treats media.s3_access_key as sensitive (defense-in-depth alongside the paired secret key)', () => {
    expect(SENSITIVE_SETTING_KEYS.has('media.s3_access_key')).toBe(true)
    expect(SENSITIVE_SETTING_KEYS.has('media.s3_secret_key')).toBe(true)
  })

  it('encrypts and round-trips media.s3_access_key like any other sensitive key', async () => {
    const s3SiteId = `${siteId}-s3`
    await seedSite(getCurrentTestDb(), { id: s3SiteId, domain: `s3-${Date.now()}.localhost` })
    const event = mkEvent(s3SiteId)
    await saveSetting(event, 'media.s3_access_key', 'AKIAABCDEFGHIJKLMNOP')

    const rows = await getCurrentTestDb().query.siteSettings.findMany()
    const stored = rows.find(r => r.siteId === s3SiteId && r.key === 'media.s3_access_key')
    expect(stored?.value).not.toBe('AKIAABCDEFGHIJKLMNOP')

    const value = await resolveSetting(event, 'media.s3_access_key')
    expect(value).toBe('AKIAABCDEFGHIJKLMNOP')
  })

  it('does not treat payments.paddle_webhook_public_key as sensitive (it is a public verification key)', () => {
    expect(SENSITIVE_SETTING_KEYS.has('payments.paddle_webhook_public_key')).toBe(false)
  })

  it('stores payments.paddle_webhook_public_key in plaintext going forward', async () => {
    const paddleSiteId = `${siteId}-paddle-plain`
    await seedSite(getCurrentTestDb(), { id: paddleSiteId, domain: `paddle-plain-${Date.now()}.localhost` })
    const event = mkEvent(paddleSiteId)
    const pem = '-----BEGIN PUBLIC KEY-----\nabc123\n-----END PUBLIC KEY-----'
    await saveSetting(event, 'payments.paddle_webhook_public_key', pem)

    const rows = await getCurrentTestDb().query.siteSettings.findMany()
    const stored = rows.find(r => r.siteId === paddleSiteId && r.key === 'payments.paddle_webhook_public_key')
    expect(stored?.value).toBe(pem)

    const value = await resolveSetting(event, 'payments.paddle_webhook_public_key')
    expect(value).toBe(pem)
  })

  it('transparently decrypts a payments.paddle_webhook_public_key value stored before it was reclassified as non-sensitive', async () => {
    const paddleSiteId = `${siteId}-paddle-legacy`
    await seedSite(getCurrentTestDb(), { id: paddleSiteId, domain: `paddle-legacy-${Date.now()}.localhost` })
    const event = mkEvent(paddleSiteId)

    // Simulate a row written back when this key was still in SENSITIVE_SETTING_KEYS —
    // saveSetting() would have encrypted it before this fix.
    const encrypted = await encryptText('legacy-pem-value', 'test-secret-exactly-32-chars-ok!')
    await seedSetting(getCurrentTestDb(), paddleSiteId, 'payments.paddle_webhook_public_key', encrypted)

    const value = await resolveSetting(event, 'payments.paddle_webhook_public_key')
    expect(value).toBe('legacy-pem-value')
  })
})

