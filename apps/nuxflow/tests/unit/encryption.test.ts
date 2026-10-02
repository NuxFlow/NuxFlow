import { describe, it, expect } from 'vitest'
import { encryptText, decryptText } from '../../server/utils/encryption'

describe('encryptText / decryptText', () => {
  const SECRET = 'a-32-char-secret-for-testing-ok!'

  it('round-trips a plain ASCII string', async () => {
    const ciphertext = await encryptText('hello world', SECRET)
    expect(ciphertext).toContain(':')
    const plaintext = await decryptText(ciphertext, SECRET)
    expect(plaintext).toBe('hello world')
  })

  it('round-trips a Unicode string', async () => {
    const input = 'こんにちは 🔑 café'
    const ciphertext = await encryptText(input, SECRET)
    const plaintext = await decryptText(ciphertext, SECRET)
    expect(plaintext).toBe(input)
  })

  it('produces different ciphertext for each call (random IV)', async () => {
    const a = await encryptText('same', SECRET)
    const b = await encryptText('same', SECRET)
    expect(a).not.toBe(b)
  })

  it('returns empty string when input is empty', async () => {
    expect(await encryptText('', SECRET)).toBe('')
    expect(await decryptText('', SECRET)).toBe('')
  })

  it('throws with wrong decryption secret', async () => {
    const ciphertext = await encryptText('secret data', SECRET)
    await expect(decryptText(ciphertext, 'wrong-secret-xxxxxxxxxxxxxxxxx')).rejects.toThrow()
  })

  it('throws on malformed ciphertext', async () => {
    await expect(decryptText('not-valid-format', SECRET)).rejects.toThrow('Invalid ciphertext format')
  })

  it('encrypts long strings correctly', async () => {
    const long = 'x'.repeat(10_000)
    const ciphertext = await encryptText(long, SECRET)
    const plaintext = await decryptText(ciphertext, SECRET)
    expect(plaintext).toBe(long)
  })

  // The key is HKDF-derived with a NuxFlow-specific `info`. A plain SHA-256 digest of the
  // secret (the derivation before HKDF, no longer accepted) must not decrypt anything —
  // re-derived independently here rather than reaching into encryption.ts's internals.
  it('rejects a value encrypted under a bare SHA-256 digest of the secret', async () => {
    const encoder = new TextEncoder()
    const sha256Key = await crypto.subtle.importKey(
      'raw', await crypto.subtle.digest('SHA-256', encoder.encode(SECRET)), { name: 'AES-GCM' }, false, ['encrypt'],
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sha256Key, encoder.encode('plaintext'))

    const toBase64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    await expect(decryptText(`${toBase64Url(iv)}:${toBase64Url(new Uint8Array(encrypted))}`, SECRET))
      .rejects.toThrow('key mismatch')
  })
})
