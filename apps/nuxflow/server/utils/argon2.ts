// Argon2id password hashing — runs directly in the main Worker.
//
// Uses @noble/hashes' pure-TS/JS Argon2id implementation (audited, zero
// dependencies, no WASM instantiation), so this needs no separate deployment
// and behaves identically in `wrangler dev` and production. This file only
// adds the PHC string encoding/decoding (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`)
// around it, since @noble/hashes returns raw derived-key bytes, not an
// encoded string. PHC is a public, implementation-independent format, so
// hashes produced here interoperate with hashes stored by any prior
// Argon2id implementation.
//
// OWASP 2024 recommended parameters: Argon2id, m=19456 KiB, t=2, p=1.
// Benchmarked at ~150-175ms per hash under these parameters — comfortably
// inside the Workers Paid plan's CPU budget (this project's minimum
// supported plan), and the underlying library yields to the event loop
// every ~10ms so it doesn't stall other concurrent requests on the isolate.

import { argon2idAsync } from '@noble/hashes/argon2.js'

const ARGON2_VERSION = 0x13 // 19
const T_COST = 2
const M_COST = 19456 // KiB (~19 MiB) — OWASP recommended
const PARALLELISM = 1
const HASH_LEN = 32 // 256-bit output
const SALT_LEN = 16 // 128-bit random salt per hash

// ── Base64 (no padding) — PHC strings use unpadded standard-alphabet base64 ────

function b64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/=+$/, '')
}

function b64Decode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const binary = atob(str + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ── PHC string encode/decode ────────────────────────────────────────────────

interface ParsedPhc {
  version: number
  m: number
  t: number
  p: number
  salt: Uint8Array
  hash: Uint8Array
}

function encodePhc(salt: Uint8Array, hash: Uint8Array): string {
  return `$argon2id$v=${ARGON2_VERSION}$m=${M_COST},t=${T_COST},p=${PARALLELISM}$${b64Encode(salt)}$${b64Encode(hash)}`
}

function parsePhc(stored: string): ParsedPhc | null {
  // ['', 'argon2id', 'v=19', 'm=19456,t=2,p=1', '<salt>', '<hash>']
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[1] !== 'argon2id') return null

  const versionPart = parts[2]?.split('=')[1]
  const params = Object.fromEntries((parts[3] ?? '').split(',').map(kv => kv.split('=')))
  const version = Number(versionPart)
  const m = Number(params.m)
  const t = Number(params.t)
  const p = Number(params.p)
  if (!Number.isFinite(version) || !Number.isFinite(m) || !Number.isFinite(t) || !Number.isFinite(p)) return null

  try {
    const salt = b64Decode(parts[4] ?? '')
    const hash = b64Decode(parts[5] ?? '')
    return { version, m, t, p, salt, hash }
  }
  catch {
    return null
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

// ── Hash / verify ─────────────────────────────────────────────────────────────

export async function argon2Hash(password: string): Promise<string> {
  const pwdBytes = new TextEncoder().encode(password.normalize('NFKC'))
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))

  const hash = await argon2idAsync(pwdBytes, salt, {
    t: T_COST,
    m: M_COST,
    p: PARALLELISM,
    dkLen: HASH_LEN,
    version: ARGON2_VERSION,
  })

  return encodePhc(salt, hash)
}

export async function argon2Verify(storedHash: string, password: string): Promise<boolean> {
  const parsed = parsePhc(storedHash)
  if (!parsed) return false

  const pwdBytes = new TextEncoder().encode(password.normalize('NFKC'))
  const computed = await argon2idAsync(pwdBytes, parsed.salt, {
    t: parsed.t,
    m: parsed.m,
    p: parsed.p,
    dkLen: parsed.hash.length,
    version: parsed.version,
  })

  return timingSafeEqual(computed, parsed.hash)
}
