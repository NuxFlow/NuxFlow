// Server-side Ed25519 verification and SHA-256 integrity utilities.
// Uses the Web Crypto API (globalThis.crypto.subtle) — native in Cloudflare Workers and Node 18+.
// Never imports node:crypto.

import { sha256Hex } from './buffer'
import { base64ToBytes } from '../../shared/lib/base64'
import { httpError } from './response'

export interface SigningPayload {
  id: string
  version: string
  serverChecksum: string  // SHA-256 hex, or 'none'
  clientChecksum: string  // SHA-256 hex, or 'none'
  definitionsChecksum: string  // SHA-256 hex of serialized blockDefinitions JSON, or 'none'
  // SHA-256 hex of the raw capabilities JSON (permissions + settings form). Present only
  // for a plugin that declares capabilities, which switches the signed input to v2 — a
  // plugin that asks for nothing keeps the v1 input, so already-signed plugins still verify.
  capabilitiesChecksum?: string
}

// ── Encoding helpers ──────────────────────────────────────────────────────────


// ── Canonical signing input ───────────────────────────────────────────────────

function canonicalInput(payload: SigningPayload): ArrayBuffer {
  const lines = [
    payload.capabilitiesChecksum ? 'nuxflow-plugin-v2' : 'nuxflow-plugin-v1',
    payload.id,
    payload.version,
    payload.serverChecksum,
    payload.clientChecksum,
    payload.definitionsChecksum,
  ]
  if (payload.capabilitiesChecksum) lines.push(payload.capabilitiesChecksum)
  return new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer
}

// ── SHA-256 integrity ─────────────────────────────────────────────────────────

export async function computeSha256(data: string): Promise<string> {
  return sha256Hex(data)
}

/**
 * Verifies that code loaded from KV matches the checksum stored in D1.
 * Throws 500 if tampered — this is a hard security failure, not a soft error.
 */
export async function assertCodeIntegrity(code: string, expectedChecksum: string, label: string): Promise<void> {
  const actual = await computeSha256(code)
  if (actual !== expectedChecksum) {
    throw httpError({
      status: 500,
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
    base64ToBytes(publicKeyB64Url),
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    base64ToBytes(signatureB64Url),
    canonicalInput(payload),
  )
}
