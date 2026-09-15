import { argon2Hash, argon2Verify } from './argon2'

// ── Better Auth password hasher ────────────────────────────────────────────────
//
// Argon2id runs directly in this Worker (see argon2.ts) — no service binding,
// no separate deployment, identical behavior in `wrangler dev` and production.

export const nuxflowPasswordHasher = {
  hash: (password: string): Promise<string> => argon2Hash(password),
  verify: ({ hash, password }: { hash: string; password: string }): Promise<boolean> => argon2Verify(hash, password),
}
