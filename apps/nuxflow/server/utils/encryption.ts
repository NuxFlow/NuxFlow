// Edge-native AES-GCM encryption and decryption utilities.
// Uses native Web Crypto API (globalThis.crypto.subtle) — compatible with Cloudflare Workers.
// Never imports node:crypto.

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

// Fixed, descriptive HKDF `info` — keeps this derivation cryptographically distinct from
// any other key ever derived from the same `betterAuthSecret` in the future (explicit
// domain separation, per current best practice for deriving more than one key from one
// base secret). A zero-length salt is standard/acceptable for HKDF when there's a single
// static input keying material and no per-use randomness to mix in (RFC 5869).
const HKDF_INFO = ENCODER.encode('nuxflow-settings-encryption-v1')
const HKDF_SALT = new Uint8Array(0)

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  // HKDF-SHA256 key derivation (current). Replaces a bare SHA-256 digest of the secret —
  // see getLegacyEncryptionKey() below for why the old derivation is still kept around.
  const baseKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    'HKDF',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// Pre-HKDF key derivation, kept ONLY as a decrypt-time fallback. Switching the primary
// derivation to HKDF changes what key gets derived from the same betterAuthSecret, which
// would make every value already encrypted under the old SHA-256-derived key undecryptable
// the moment this shipped — a real risk for settings already stored in a live deployment
// (payment provider secret keys, AI API keys, etc). decryptText() below tries the new HKDF
// key first and falls back to this one only on failure, so already-encrypted rows keep
// working with no manual migration step; encryptText() never uses this — every write goes
// out under the new HKDF-derived key, so stored ciphertext self-migrates the next time each
// value is saved.
async function getLegacyEncryptionKey(secret: string): Promise<CryptoKey> {
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

  const iv = fromBase64Url(ivB64)
  const ciphertext = fromBase64Url(cipherB64)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Try the current HKDF-derived key first. AES-GCM's authentication tag makes decrypting
  // under the wrong key fail loudly (not silently produce garbage), so this is a safe
  // "try new, fall back to old" migration: existing rows encrypted before the HKDF switch
  // (see getLegacyEncryptionKey() above) still decrypt correctly via the fallback, while
  // every value re-saved from now on is encrypted under the new key on write and so no
  // longer needs the fallback the next time it's read.
  try {
    const key = await getEncryptionKey(secret)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as any }, key, ciphertext as any)
    return DECODER.decode(decrypted)
  } catch {
    // Fall through to the legacy key below.
  }

  try {
    const legacyKey = await getLegacyEncryptionKey(secret)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as any }, legacyKey, ciphertext as any)
    return DECODER.decode(decrypted)
  } catch {
    throw new Error('Failed to decrypt data: key mismatch or corrupted ciphertext')
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
