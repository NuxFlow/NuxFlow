/**
 * Encodes a byte buffer as lowercase hex — the shared primitive behind every SHA-256/HMAC
 * digest-to-string conversion in this codebase (API key hashing, setup token hashing,
 * webhook signature verification, plugin signature verification, S3 request signing).
 */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** SHA-256 of a UTF-8 string, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  return bufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}
