import { describe, it, expect } from 'vitest'
import { base64ToBytes, bytesToBase64, bytesToBase64Url, randomToken } from '../../shared/lib/base64'

describe('base64 helpers', () => {
  const bytes = new Uint8Array([0xFB, 0xFF, 0xBF, 0x00, 0x10])

  it('encodes with the standard and URL-safe alphabets', () => {
    expect(bytesToBase64(bytes)).toBe('+/+/ABA=')
    expect(bytesToBase64Url(bytes)).toBe('-_-_ABA')
    expect(bytesToBase64(bytes.buffer)).toBe('+/+/ABA=')
  })

  it('decodes either alphabet, padded or not', () => {
    for (const s of ['+/+/ABA=', '+/+/ABA', '-_-_ABA']) {
      expect([...base64ToBytes(s)]).toEqual([...bytes])
    }
  })

  it('round-trips a buffer too large to spread into String.fromCharCode', () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64Url(big))).toEqual(big)
  })

  it('throws on input that is not base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow()
  })

  it('makes URL-safe random tokens of the requested size', () => {
    const token = randomToken()
    expect(token).toMatch(/^[\w-]{43}$/)
    expect(base64ToBytes(token)).toHaveLength(32)
    expect(randomToken()).not.toBe(token)
  })
})
