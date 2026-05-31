// Edge-native AES-GCM encryption and decryption utilities.
// Uses native Web Crypto API (globalThis.crypto.subtle) — compatible with Cloudflare Workers.
// Never imports node:crypto.

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  // Use SHA-256 to hash the secret to a 256-bit raw key buffer
  const hash = await crypto.subtle.digest('SHA-256', ENCODER.encode(secret))
  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypts cleartext using AES-GCM and returns `ivBase64Url:ciphertextBase64Url`.
 */
export async function encryptText(cleartext: string, secret: string): Promise<string> {
  if (!cleartext) return ''
  const key = await getEncryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    ENCODER.encode(cleartext)
  )

  // Encode the IV and ciphertext as base64url so they are URL-safe and compact
  const ivB64 = btoa(String.fromCharCode(...iv))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const encryptedBytes = new Uint8Array(encrypted)
  const cipherB64 = btoa(String.fromCharCode(...encryptedBytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `${ivB64}:${cipherB64}`
}

/**
 * Decrypts `ivBase64Url:ciphertextBase64Url` using AES-GCM.
 */
export async function decryptText(ciphertextWithIv: string, secret: string): Promise<string> {
  if (!ciphertextWithIv) return ''
  const parts = ciphertextWithIv.split(':')
  if (parts.length !== 2) {
    throw new Error('Invalid ciphertext format')
  }

  const [ivB64, cipherB64] = parts as [string, string]

  const fromBase64Url = (s: string): Uint8Array => {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  try {
    const iv = fromBase64Url(ivB64)
    const ciphertext = fromBase64Url(cipherB64)

    const key = await getEncryptionKey(secret)
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      key,
      ciphertext as any
    )
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return DECODER.decode(decrypted)
  } catch {
    throw new Error('Failed to decrypt data: key mismatch or corrupted ciphertext')
  }
}
