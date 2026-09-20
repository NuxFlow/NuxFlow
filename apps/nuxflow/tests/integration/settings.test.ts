import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedRole, seedUser } from '../helpers/seed'
import { resolveSetting, saveSetting, batchSaveSettings, SENSITIVE_SETTING_KEYS, SECRET_MASK } from '../../server/utils/settings'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: patchHandler } = await import('../../server/api/v1/settings/index.patch')

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

  it('treats payments.paddle_webhook_secret as sensitive (Paddle signs webhooks with HMAC-SHA256 keyed by this shared secret, not an asymmetric keypair)', () => {
    expect(SENSITIVE_SETTING_KEYS.has('payments.paddle_webhook_secret')).toBe(true)
  })

  it('encrypts and round-trips payments.paddle_webhook_secret like any other sensitive key', async () => {
    const paddleSiteId = `${siteId}-paddle`
    await seedSite(getCurrentTestDb(), { id: paddleSiteId, domain: `paddle-${Date.now()}.localhost` })
    const event = mkEvent(paddleSiteId)
    const secret = 'pdl_ntfset_abc123'
    await saveSetting(event, 'payments.paddle_webhook_secret', secret)

    const rows = await getCurrentTestDb().query.siteSettings.findMany()
    const stored = rows.find(r => r.siteId === paddleSiteId && r.key === 'payments.paddle_webhook_secret')
    expect(stored?.value).not.toBe(secret)

    const value = await resolveSetting(event, 'payments.paddle_webhook_secret')
    expect(value).toBe(secret)
  })
})

describe('batchSaveSettings', () => {
  it('saves multiple keys, including a mix of sensitive and plain, in one call', async () => {
    const batchSiteId = `${siteId}-batch`
    await seedSite(getCurrentTestDb(), { id: batchSiteId, domain: `batch-${Date.now()}.localhost` })
    const event = mkEvent(batchSiteId)

    await batchSaveSettings(event, [
      ['site.tagline', 'Batched tagline'],
      ['ai.openai_api_key', 'sk-batched-key'],
      ['theme.primary_color', '#ff0000'],
    ])

    expect(await resolveSetting(event, 'site.tagline')).toBe('Batched tagline')
    expect(await resolveSetting(event, 'ai.openai_api_key')).toBe('sk-batched-key')
    expect(await resolveSetting(event, 'theme.primary_color')).toBe('#ff0000')

    // The sensitive key must actually be encrypted at rest, same as saveSetting().
    const rows = await getCurrentTestDb().query.siteSettings.findMany()
    const stored = rows.find(r => r.siteId === batchSiteId && r.key === 'ai.openai_api_key')
    expect(stored?.value).not.toBe('sk-batched-key')
  })

  it('skips a SECRET_MASK entry within a batch without touching the others', async () => {
    const maskBatchSiteId = `${siteId}-batch-mask`
    await seedSite(getCurrentTestDb(), { id: maskBatchSiteId, domain: `batch-mask-${Date.now()}.localhost` })
    const event = mkEvent(maskBatchSiteId)

    await saveSetting(event, 'payments.stripe_secret_key', 'sk_live_original')
    await batchSaveSettings(event, [
      ['payments.stripe_secret_key', SECRET_MASK],
      ['site.tagline', 'Updated alongside a masked secret'],
    ])

    expect(await resolveSetting(event, 'payments.stripe_secret_key')).toBe('sk_live_original')
    expect(await resolveSetting(event, 'site.tagline')).toBe('Updated alongside a masked secret')
  })

  it('deletes a key within a batch when its value is empty', async () => {
    const delBatchSiteId = `${siteId}-batch-del`
    await seedSite(getCurrentTestDb(), { id: delBatchSiteId, domain: `batch-del-${Date.now()}.localhost` })
    const event = mkEvent(delBatchSiteId)

    await saveSetting(event, 'site.desc.batch-del', 'to delete')
    await batchSaveSettings(event, [['site.desc.batch-del', '']])

    expect(await resolveSetting(event, 'site.desc.batch-del')).toBe('')
  })

  it('is a no-op for an empty entries array', async () => {
    const event = mkEvent()
    await expect(batchSaveSettings(event, [])).resolves.toBeUndefined()
  })
})

describe('PATCH /api/v1/settings (end-to-end multi-section save)', () => {
  it('saves site columns, generic settings, and structured ai/media/auth fields together', async () => {
    const routeSiteId = `${siteId}-route`
    await seedSite(getCurrentTestDb(), { id: routeSiteId, domain: `route-${Date.now()}.localhost` })
    const adminId = await seedUser(getCurrentTestDb(), { email: `admin-${Date.now()}@settings-route.test` })
    await seedRole(getCurrentTestDb(), adminId, routeSiteId, 'admin')

    const event = createMockEvent({
      siteId: routeSiteId,
      session: { user: { id: adminId, name: 'Admin', email: 'admin@settings-route.test' } },
      body: {
        name: 'Renamed Site',
        settings: { 'site.tagline': 'A route-level tagline' },
        ai: { provider: 'anthropic', anthropicApiKey: 'sk-ant-route' },
        media: { r2PublicUrl: 'https://media.example.com' },
        auth: { googleClientId: 'google-client-id-route' },
      },
    }) as unknown as H3Event

    const result = await (patchHandler as (e: H3Event) => Promise<unknown>)(event)
    expect(result).toEqual({ success: true })

    const resolveEvent = mkEvent(routeSiteId)
    expect(await resolveSetting(resolveEvent, 'site.tagline')).toBe('A route-level tagline')
    expect(await resolveSetting(resolveEvent, 'ai.provider')).toBe('anthropic')
    expect(await resolveSetting(resolveEvent, 'ai.anthropic_api_key')).toBe('sk-ant-route')
    expect(await resolveSetting(resolveEvent, 'media.r2_public_url')).toBe('https://media.example.com')
    expect(await resolveSetting(resolveEvent, 'auth.google_client_id')).toBe('google-client-id-route')

    const site = await getCurrentTestDb().query.sites.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.id, routeSiteId) })
    expect(site?.name).toBe('Renamed Site')
  })

  it('rejects a viewer-role caller', async () => {
    const forbiddenSiteId = `${siteId}-forbidden`
    await seedSite(getCurrentTestDb(), { id: forbiddenSiteId, domain: `forbidden-${Date.now()}.localhost` })
    const viewerId = await seedUser(getCurrentTestDb(), { email: `viewer-${Date.now()}@settings-route.test` })
    await seedRole(getCurrentTestDb(), viewerId, forbiddenSiteId, 'viewer')

    const event = createMockEvent({
      siteId: forbiddenSiteId,
      session: { user: { id: viewerId, name: 'Viewer', email: 'viewer@settings-route.test' } },
      body: { settings: { 'site.tagline': 'nope' } },
    }) as unknown as H3Event

    await expect((patchHandler as (e: H3Event) => Promise<unknown>)(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

