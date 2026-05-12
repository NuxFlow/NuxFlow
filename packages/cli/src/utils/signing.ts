// Ed25519 signing and SHA-256 integrity utilities.
// Uses the Web Crypto API (globalThis.crypto.subtle) — available in Node 18+ and Cloudflare Workers.
// Never imports node:crypto.

export interface SigningPayload {
  id: string
  version: string
  serverChecksum: string  // SHA-256 hex of raw server code, or 'none'
  clientChecksum: string  // SHA-256 hex of raw client bundle, or 'none'
}

export interface KeyPair {
  privateKey: string  // base64url-encoded PKCS8
  publicKey: string   // base64url-encoded SPKI
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64Url(s: string): ArrayBuffer {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Canonical signing input ───────────────────────────────────────────────────
// Covers plugin identity and exact code hashes — any code change invalidates the signature.

function canonicalInput(payload: SigningPayload): ArrayBuffer {
  const text = [
    'nuxflow-plugin-v1',
    payload.id,
    payload.version,
    payload.serverChecksum,
    payload.clientChecksum,
  ].join('\n')
  return new TextEncoder().encode(text)
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

export async function computeSha256(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(buffer)
}

// ── Key generation ────────────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair

  const [privateKeyBuffer, publicKeyBuffer] = await Promise.all([
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    crypto.subtle.exportKey('spki', keyPair.publicKey),
  ])

  return {
    privateKey: toBase64Url(privateKeyBuffer),
    publicKey: toBase64Url(publicKeyBuffer),
  }
}

// ── Sign ──────────────────────────────────────────────────────────────────────

export async function signPayload(privateKeyB64Url: string, payload: SigningPayload): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    fromBase64Url(privateKeyB64Url),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    canonicalInput(payload),
  )
  return toBase64Url(signature)
}

// ── Verify ────────────────────────────────────────────────────────────────────

export async function verifyPayload(
  publicKeyB64Url: string,
  payload: SigningPayload,
  signatureB64Url: string,
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    fromBase64Url(publicKeyB64Url),
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    fromBase64Url(signatureB64Url),
    canonicalInput(payload),
  )
}
