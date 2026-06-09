import { describe, it, expect, beforeAll } from 'vitest'
import { computeSha256, verifyPluginSignature, assertCodeIntegrity } from '../../server/utils/plugin-signing'
import type { SigningPayload } from '../../server/utils/plugin-signing'

// Set createError global so assertCodeIntegrity can throw it
;(globalThis as Record<string, unknown>).createError = ({ statusCode, message }: { statusCode?: number; message?: string }) => {
  const err = new Error(message ?? 'Error') as Error & { statusCode: number }
  err.statusCode = statusCode ?? 500
  return err
}

// ---------------------------------------------------------------------------
// Helpers — generate a real Ed25519 key pair for round-trip tests
// ---------------------------------------------------------------------------

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function generateTestKeyPair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    'Ed25519' as unknown as EcKeyGenParams,
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  return { privateKey, publicKeyB64Url: toBase64Url(spki) }
}

async function signPayload(privateKey: CryptoKey, payload: SigningPayload): Promise<string> {
  const canonical = [
    'nuxflow-plugin-v1',
    payload.id,
    payload.version,
    payload.serverChecksum,
    payload.clientChecksum,
  ].join('\n')
  const sig = await crypto.subtle.sign(
    'Ed25519' as unknown as AlgorithmIdentifier,
    privateKey,
    new TextEncoder().encode(canonical),
  )
  return toBase64Url(sig)
}

// ---------------------------------------------------------------------------

describe('computeSha256', () => {
  it('returns a 64-char hex string', async () => {
    const hash = await computeSha256('hello')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('returns the known SHA-256 of empty string', async () => {
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hash = await computeSha256('')
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('produces identical output for identical input', async () => {
    const a = await computeSha256('test')
    const b = await computeSha256('test')
    expect(a).toBe(b)
  })

  it('produces different output for different input', async () => {
    const a = await computeSha256('foo')
    const b = await computeSha256('bar')
    expect(a).not.toBe(b)
  })
})

describe('assertCodeIntegrity', () => {
  it('passes when code matches the expected checksum', async () => {
    const code = 'export default function() {}'
    const checksum = await computeSha256(code)
    await expect(assertCodeIntegrity(code, checksum, 'test-plugin')).resolves.toBeUndefined()
  })

  it('throws 500 when code has been tampered with', async () => {
    const code = 'export default function() {}'
    await expect(assertCodeIntegrity(code, 'deadbeef'.repeat(8), 'test-plugin')).rejects.toMatchObject({
      statusCode: 500,
    })
  })
})

describe('verifyPluginSignature', () => {
  let publicKeyB64Url: string
  let privateKey: CryptoKey

  beforeAll(async () => {
    const kp = await generateTestKeyPair()
    publicKeyB64Url = kp.publicKeyB64Url
    privateKey = kp.privateKey
  })

  const payload: SigningPayload = {
    id: 'my-plugin',
    version: '2.1.0',
    serverChecksum: 'abc123def456',
    clientChecksum: 'none',
  }

  it('returns true for a valid Ed25519 signature', async () => {
    const sig = await signPayload(privateKey, payload)
    const result = await verifyPluginSignature(publicKeyB64Url, payload, sig)
    expect(result).toBe(true)
  })

  it('returns false for a tampered payload', async () => {
    const sig = await signPayload(privateKey, payload)
    const tampered = { ...payload, version: '9.9.9' }
    const result = await verifyPluginSignature(publicKeyB64Url, tampered, sig)
    expect(result).toBe(false)
  })

  it('returns false for a garbled signature', async () => {
    const result = await verifyPluginSignature(publicKeyB64Url, payload, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(result).toBe(false)
  })
})
