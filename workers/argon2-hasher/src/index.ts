// Argon2id password hasher — Cloudflare Worker accessed via service binding.
//
// argon2-browser v1.18 ships a minified Emscripten build. The Wasm binary is
// imported statically so Wrangler pre-compiles it to a WebAssembly.Module at
// bundle time, bypassing the "WebAssembly.compile() disallowed by embedder"
// restriction in CF Workers.
//
// Import/export mapping extracted from argon2-browser/dist/argon2.js:
//   imports:  module "a" → { "a": emscripten_memcpy_big, "b": emscripten_resize_heap }
//   exports:  "c"=memory, "d"=___wasm_call_ctors, "e"=_argon2_hash,
//             "f"=_malloc, "g"=_free, "h"=_argon2_verify,
//             "i"=_argon2_error_message, "j"=_argon2_encodedlen
//
// OWASP 2024 recommended parameters: Argon2id, m=19456 KiB, t=2, p=1.

import { WorkerEntrypoint } from 'cloudflare:workers'
import argon2WasmModule from './argon2.wasm'

// ── Constants ──────────────────────────────────────────────────────────────────

const ARGON2ID = 2
const ARGON2_VERSION = 0x13  // 19
const T_COST = 2
const M_COST = 19456          // KiB (~19 MiB) — OWASP recommended
const PARALLELISM = 1
const HASH_LEN = 32           // 256-bit output
const SALT_LEN = 16           // 128-bit random salt per hash

// ── Wasm memory — populated after instantiation, updated after every grow ──────

let wasmMemory: WebAssembly.Memory
let HEAPU8: Uint8Array

function updateMemoryViews(): void {
  HEAPU8 = new Uint8Array(wasmMemory.buffer)
}

function alignUp(x: number, multiple: number): number {
  const rem = x % multiple
  return rem === 0 ? x : x + multiple - rem
}

// ── Wasm import implementations (module "a") ───────────────────────────────────

function emscripten_memcpy_big(dest: number, src: number, num: number): void {
  HEAPU8.copyWithin(dest, src, src + num)
}

function emscripten_resize_heap(requestedSize: number): number {
  const oldSize = wasmMemory.buffer.byteLength
  const maxHeapSize = 2147418112  // ~2 GiB
  if (requestedSize > maxHeapSize) return 0

  // Mirrors Emscripten's growth algorithm: try up to 4 progressively smaller
  // over-allocations before giving up.
  for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
    let candidate = oldSize * (1 + 0.2 / cutDown)
    candidate = Math.min(candidate, requestedSize + 100663296)
    const newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, candidate), 65536))
    const pages = (newSize - oldSize + 65535) >>> 16
    try {
      wasmMemory.grow(pages)
      updateMemoryViews()
      return 1
    } catch {
      // try next iteration with smaller growth
    }
  }
  return 0
}

// ── Wasm export interface (minified names) ─────────────────────────────────────

interface ArgonExports {
  c: WebAssembly.Memory
  d: () => void
  e: (
    tCost: number, mCost: number, parallelism: number,
    pwdPtr: number, pwdLen: number,
    saltPtr: number, saltLen: number,
    hashPtr: number, hashLen: number,
    encPtr: number, encLen: number,
    type: number, version: number,
  ) => number
  f: (size: number) => number
  g: (ptr: number) => void
  h: (encPtr: number, pwdPtr: number, pwdLen: number, type: number) => number
  i: (code: number) => number
  j: (
    tCost: number, mCost: number, parallelism: number,
    saltLen: number, hashLen: number, type: number,
  ) => number
}

// ── Lazy singleton — Wasm instance cached for the lifetime of the isolate ──────

let _exports: ArgonExports | null = null

async function getArgon(): Promise<ArgonExports> {
  if (_exports) return _exports

  const instance = await WebAssembly.instantiate(
    argon2WasmModule as unknown as WebAssembly.Module,
    { a: { a: emscripten_memcpy_big, b: emscripten_resize_heap } } as WebAssembly.Imports,
  ) as unknown as WebAssembly.Instance

  const exp = instance.exports as unknown as ArgonExports

  // Capture memory BEFORE calling init so that any memory operations during
  // ___wasm_call_ctors have a valid HEAPU8 view to work with.
  wasmMemory = exp.c
  updateMemoryViews()
  exp.d()  // ___wasm_call_ctors — initialises C static state

  _exports = exp
  return exp
}

// ── Memory helpers ────────────────────────────────────────────────────────────

function writeToWasm(ptr: number, data: Uint8Array): void {
  HEAPU8.set(data, ptr)
}

function readCString(ptr: number): string {
  let end = ptr
  while (HEAPU8[end] !== 0) end++
  return new TextDecoder().decode(HEAPU8.subarray(ptr, end))
}

// ── Hash / verify ─────────────────────────────────────────────────────────────

async function argon2Hash(password: string): Promise<string> {
  const exp = await getArgon()

  const pwdBytes = new TextEncoder().encode(password.normalize('NFKC'))
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LEN))

  const encodedLen = exp.j(T_COST, M_COST, PARALLELISM, SALT_LEN, HASH_LEN, ARGON2ID)

  const pwdPtr = exp.f(pwdBytes.length)
  const saltPtr = exp.f(SALT_LEN)
  const hashPtr = exp.f(HASH_LEN)
  const encPtr = exp.f(encodedLen)

  try {
    writeToWasm(pwdPtr, pwdBytes)
    writeToWasm(saltPtr, saltBytes)

    const rc = exp.e(
      T_COST, M_COST, PARALLELISM,
      pwdPtr, pwdBytes.length,
      saltPtr, SALT_LEN,
      hashPtr, HASH_LEN,
      encPtr, encodedLen,
      ARGON2ID, ARGON2_VERSION,
    )

    if (rc !== 0) {
      const msgPtr = exp.i(rc)
      throw new Error(`argon2_hash failed (${rc}): ${readCString(msgPtr)}`)
    }

    return readCString(encPtr)
  } finally {
    if (pwdPtr) {
      HEAPU8.fill(0, pwdPtr, pwdPtr + pwdBytes.length)
    }
    exp.g(pwdPtr)
    exp.g(saltPtr)
    exp.g(hashPtr)
    exp.g(encPtr)
  }
}

async function argon2Verify(storedHash: string, password: string): Promise<boolean> {
  const exp = await getArgon()

  const encBytes = new TextEncoder().encode(storedHash + '\0')
  const pwdBytes = new TextEncoder().encode(password.normalize('NFKC'))

  const encPtr = exp.f(encBytes.length)
  const pwdPtr = exp.f(pwdBytes.length)

  try {
    writeToWasm(encPtr, encBytes)
    writeToWasm(pwdPtr, pwdBytes)

    const rc = exp.h(encPtr, pwdPtr, pwdBytes.length, ARGON2ID)
    return rc === 0  // ARGON2_OK = 0
  } finally {
    if (pwdPtr) {
      HEAPU8.fill(0, pwdPtr, pwdPtr + pwdBytes.length)
    }
    exp.g(encPtr)
    exp.g(pwdPtr)
  }
}

// ── WorkerEntrypoint — called via service binding RPC ─────────────────────────

export default class ArgonHasherWorker extends WorkerEntrypoint {
  // Required by Cloudflare to satisfy the "registered event handler" check.
  // This Worker is accessed exclusively via service binding RPC — direct HTTP
  // requests return 405 so it cannot be used as a public endpoint.
  async fetch(_request: Request): Promise<Response> {
    return new Response('Service binding only — not a public endpoint.', { status: 405 })
  }

  async hash(password: string): Promise<string> {
    return argon2Hash(password)
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    return argon2Verify(storedHash, password)
  }
}
