const ITERATIONS = 100_000

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256)
  const toHex = (arr: Uint8Array) => Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:sha256:${ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(bits))}`
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = hash.split(':')
  if (parts[0] !== 'pbkdf2' || parts.length !== 5) return false
  const iterations = Number.parseInt(parts[2]!, 10)
  if (!iterations || iterations < 1) return false
  const fromHex = (s: string) => new Uint8Array(s.match(/.{2}/g)?.map(h => Number.parseInt(h, 16)) ?? [])
  const salt = fromHex(parts[3]!)
  const storedHash = fromHex(parts[4]!)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  const derived = new Uint8Array(bits)
  if (derived.length !== storedHash.length) return false
  let diff = 0
  for (let i = 0; i < derived.length; i++) diff |= derived[i]! ^ storedHash[i]!
  return diff === 0
}
