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
})
