// Base64 and base64url ↔ bytes, shared by the server and the browser. Encoding works in
// chunks: spreading a large Uint8Array into String.fromCharCode(...) overflows the call
// stack once it reaches the hundreds of KB an image easily is.

export function bytesToBase64(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** URL-safe alphabet, no padding (RFC 4648 §5). */
export function bytesToBase64Url(input: Uint8Array | ArrayBuffer): string {
  return bytesToBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decodes base64 or base64url, padded or not. Throws on invalid input (like atob).
 * Returns Uint8Array<ArrayBuffer>, which Web Crypto accepts as a BufferSource.
 */
export function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A random, URL-safe token: `byteLength` random bytes as unpadded base64url. */
export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}
