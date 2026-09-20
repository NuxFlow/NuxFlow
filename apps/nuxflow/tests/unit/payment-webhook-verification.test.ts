import { describe, it, expect } from 'vitest'
import { PaddleProvider } from '../../server/utils/payments/paddle'
import { LemonSqueezyProvider } from '../../server/utils/payments/lemonsqueezy'

// Mock h3's createError global — paddle.ts's helper functions don't call it directly,
// but keeping this consistent with security.test.ts in case that changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).createError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).createError = (err: { statusCode: number; message: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = new Error(err.message) as any
    error.statusCode = err.statusCode
    return error
  }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Exercises the real crypto in each provider's verifyWebhook against a signature this
 * test computes itself (rather than mocking verifyWebhook, the way
 * tests/integration/webhooks.test.ts does for the webhook route) — this is exactly the
 * gap that let PaddleProvider.verifyWebhook ship as an Ed25519 asymmetric check against
 * a value Paddle actually signs with HMAC-SHA256: every existing test mocked the method
 * away instead of computing a real signature, so a wrong algorithm never failed CI.
 */
describe('PaddleProvider.verifyWebhook (real HMAC-SHA256, per Paddle Billing docs)', () => {
  const provider = new PaddleProvider('pdl_key', '12345')
  const secret = 'pdl_ntfset_test_secret'

  it('accepts a correctly computed HMAC-SHA256 signature', async () => {
    const rawBody = JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_1' } })
    const ts = '1700000000'
    const h1 = await hmacSha256Hex(secret, `${ts}:${rawBody}`)

    const valid = await provider.verifyWebhook(rawBody, `ts=${ts};h1=${h1}`, secret)
    expect(valid).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const rawBody = JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_1' } })
    const ts = '1700000000'
    const h1 = await hmacSha256Hex('wrong-secret', `${ts}:${rawBody}`)

    const valid = await provider.verifyWebhook(rawBody, `ts=${ts};h1=${h1}`, secret)
    expect(valid).toBe(false)
  })

  it('rejects a tampered body even when the signature looks well-formed', async () => {
    const ts = '1700000000'
    const h1 = await hmacSha256Hex(secret, `${ts}:${JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_1' } })}`)
    const tamperedBody = JSON.stringify({ event_type: 'subscription.activated', data: { id: 'sub_2' } })

    const valid = await provider.verifyWebhook(tamperedBody, `ts=${ts};h1=${h1}`, secret)
    expect(valid).toBe(false)
  })

  it('fails closed on a malformed signature header', async () => {
    expect(await provider.verifyWebhook('{}', 'not-a-valid-header', secret)).toBe(false)
    expect(await provider.verifyWebhook('{}', '', secret)).toBe(false)
    expect(await provider.verifyWebhook('{}', 'ts=123', secret)).toBe(false)
  })

  it('never verifies as an Ed25519/PEM public key — a stray PEM value must fail closed, not throw', async () => {
    const rawBody = '{}'
    const pemLikeValue = '-----BEGIN PUBLIC KEY-----\nabc123\n-----END PUBLIC KEY-----'
    // A PEM string is not a valid HMAC key shape, but importKey('raw', ...) accepts any
    // byte string as a key, so this must resolve to `false` (real signature mismatch)
    // rather than throwing — regression guard for the old Ed25519 implementation, which
    // depended on this exact value being real key material.
    await expect(provider.verifyWebhook(rawBody, 'ts=1;h1=deadbeef', pemLikeValue)).resolves.toBe(false)
  })
})

describe('LemonSqueezyProvider.verifyWebhook (real HMAC-SHA256, unchanged reference implementation)', () => {
  const provider = new LemonSqueezyProvider('ls_key', 'store_1')
  const secret = 'ls_webhook_secret'

  it('accepts a correctly computed HMAC-SHA256 signature', async () => {
    const rawBody = JSON.stringify({ meta: { event_name: 'subscription_created' } })
    const h1 = await hmacSha256Hex(secret, rawBody)

    expect(await provider.verifyWebhook(rawBody, h1, secret)).toBe(true)
  })

  it('rejects an invalid signature', async () => {
    expect(await provider.verifyWebhook('{}', 'deadbeef', secret)).toBe(false)
  })
})
