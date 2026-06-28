import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite } from '../helpers/seed'
import { resolveSetting, saveSetting, SENSITIVE_SETTING_KEYS, SECRET_MASK } from '../../server/utils/settings'

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
})

