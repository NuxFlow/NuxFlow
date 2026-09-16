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

  // Regression coverage for the HKDF migration: encryptText/decryptText used to derive
  // the AES-GCM key via a bare SHA-256 digest of the secret. Switching to HKDF (for
  // explicit domain separation) must not brick values a live deployment already encrypted
  // under the old derivation — decryptText() falls back to the pre-HKDF derivation when
  // the current key fails to decrypt. This test re-derives that old key independently
  // (rather than reaching into encryption.ts's internals) to prove the fallback path
  // actually works end-to-end, not just that the code compiles.
  it('decrypts a value encrypted under the old pre-HKDF (bare SHA-256) key derivation', async () => {
    const encoder = new TextEncoder()
    const legacyHash = await crypto.subtle.digest('SHA-256', encoder.encode(SECRET))
    const legacyKey = await crypto.subtle.importKey('raw', legacyHash, { name: 'AES-GCM' }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKey, encoder.encode('legacy-plaintext'))

    const toBase64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const legacyCiphertext = `${toBase64Url(iv)}:${toBase64Url(new Uint8Array(encrypted))}`

    const plaintext = await decryptText(legacyCiphertext, SECRET)
    expect(plaintext).toBe('legacy-plaintext')
  })

  it('a value freshly encrypted (current HKDF key) round-trips without needing the legacy fallback', async () => {
    const ciphertext = await encryptText('current-plaintext', SECRET)
    const plaintext = await decryptText(ciphertext, SECRET)
    expect(plaintext).toBe('current-plaintext')
  })
})
