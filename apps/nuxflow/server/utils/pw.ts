import type { ArgonHasherBinding } from '../types/cloudflare-bindings'

// ── Service binding access ─────────────────────────────────────────────────────
//
// Nitro's cloudflare-module preset copies the full CF bindings object into
// globalThis.__env__ before any request handler runs, so ARGON2 is always
// present in production without needing a per-request event reference.
// In local `pnpm dev` (Node.js Nuxt dev server) the binding is absent and we
// fall back to node:crypto.scrypt so development auth still works.

function getArgon2(): ArgonHasherBinding | null {
  const env = (globalThis as { __env__?: Record<string, unknown> }).__env__
  return (env?.ARGON2 as ArgonHasherBinding | undefined) ?? null
}

// ── Dev fallback — node:crypto.scrypt ─────────────────────────────────────────
//
// Used only when the ARGON2 service binding is unavailable (e.g. `wrangler dev`
// without the argon2-hasher worker linked). Produces the same saltHex:keyHex format as Better Auth's default
// so the dev database behaves normally. Dev hashes are NOT portable to production
// — production always starts from a fresh wipe with Argon2id hashes.

async function scryptHash(password: string): Promise<string> {
  const { randomBytes, scrypt } = await import('node:crypto')
  const salt = randomBytes(16).toString('hex')
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err)
      else resolve(`${salt}:${(key as Buffer).toString('hex')}`)
    })
  })
}

async function scryptVerify(storedHash: string, password: string): Promise<boolean> {
  const { scrypt } = await import('node:crypto')
  const [salt, keyHex] = storedHash.split(':')
  if (!salt || !keyHex) return false
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err)
      else resolve((key as Buffer).toString('hex') === keyHex)
    })
  })
}

// ── Better Auth password hasher ────────────────────────────────────────────────

export const nuxflowPasswordHasher = {
  hash: async (password: string): Promise<string> => {
    const argon2 = getArgon2()
    if (argon2) return argon2.hash(password)
    return scryptHash(password)
  },

  verify: async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
    // Argon2id PHC strings always start with "$argon2"
    if (hash.startsWith('$argon2')) {
      const argon2 = getArgon2()
      if (argon2) return argon2.verify(hash, password)
      // Binding absent in dev — can't verify a production Argon2id hash locally
      return false
    }
    // Legacy/dev scrypt format: saltHex:keyHex
    return scryptVerify(hash, password)
  },
}
