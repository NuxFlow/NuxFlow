import { bufferToHex } from './buffer'

/**
 * Constant-time comparison of two equal-length hex strings (e.g. a computed HMAC digest
 * against a webhook's signature header) — a plain `===` on the hex string leaks per-character
 * timing, letting an attacker recover a valid signature byte-by-byte over enough requests.
 * `node:crypto`'s `timingSafeEqual` is unavailable in this codebase (Workers-only, no
 * node:crypto), so this hand-rolls the same XOR-accumulate-without-early-exit technique.
 * Comparing `.length` first is safe (not a content-dependent timing leak) since a correct
 * HMAC-SHA256 hex digest always has the same fixed, publicly-known length; a length
 * mismatch just means "not even shaped like a valid signature," decided in O(1) either way.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Computes an HMAC-SHA256 digest of `payload` keyed by `secret`, returned as lowercase hex —
 * shared by LemonSqueezyProvider and PaddleProvider's `verifyWebhook`, which both sign a
 * provider-specific payload string with the same primitive and only differ in how that
 * string is constructed (raw body vs. `${ts}:${rawBody}`) and which header field they
 * compare the result against.
 */
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return bufferToHex(mac)
}
