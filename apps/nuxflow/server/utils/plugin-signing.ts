// Server-side Ed25519 verification and SHA-256 integrity utilities.
// Uses the Web Crypto API (globalThis.crypto.subtle) — native in Cloudflare Workers and Node 18+.
// Never imports node:crypto.

export interface SigningPayload {
  id: string
  version: string
  serverChecksum: string  // SHA-256 hex, or 'none'
  clientChecksum: string  // SHA-256 hex, or 'none'
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

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

// ── SHA-256 integrity ─────────────────────────────────────────────────────────

export async function computeSha256(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(buffer)
}

/**
 * Verifies that code loaded from KV matches the checksum stored in D1.
 * Throws 500 if tampered — this is a hard security failure, not a soft error.
 */
export async function assertCodeIntegrity(code: string, expectedChecksum: string, label: string): Promise<void> {
  const actual = await computeSha256(code)
  if (actual !== expectedChecksum) {
    throw createError({
      statusCode: 500,
      message: `Plugin ${label} integrity check failed — KV content does not match the stored checksum. The plugin may have been tampered with.`,
    })
  }
}

// ── Ed25519 signature verification ───────────────────────────────────────────

export async function verifyPluginSignature(
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
