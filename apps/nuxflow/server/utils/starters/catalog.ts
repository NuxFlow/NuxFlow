// The starter-site catalog: fetched from the configured URL, its Ed25519 signature checked
// against a pinned key, cached per isolate. A catalog that can't be fetched or doesn't verify
// is reported as an error and simply leaves the built-in starters — never a failed page.
import type { H3Event } from 'h3'
import {
  catalogSigningInput,
  starterCatalogFileSchema,
  starterCatalogPayloadSchema,
  type StarterCatalogEntry,
} from '../../../shared/lib/starters'
import { base64ToBytes } from '../../../shared/lib/base64'
import { bufferToHex } from '../buffer'
import { withTimeout } from '../timeout'

/** The NuxFlow project's starter catalog. Operators can point at their own with NUXT_STARTERS_CATALOG_URL. */
export const DEFAULT_STARTERS_CATALOG_URL = 'https://starters.nuxflow.dev/catalog.json'
/**
 * Public half of the key the official catalog is signed with (`pnpm starters:build`).
 * An operator running their own catalog sets NUXT_STARTERS_PUBLIC_KEY to theirs.
 */
export const DEFAULT_STARTERS_PUBLIC_KEY = 'MCowBQYDK2VwAyEAACK3-jhAe181gyLH3ia0NMdXRwKM3ktFPgYPNXjx6To'

const CACHE_MS = 10 * 60_000
const ERROR_CACHE_MS = 60_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_CATALOG_BYTES = 2 * 1024 * 1024

export interface StarterCatalog {
  url: string
  starters: StarterCatalogEntry[]
}

export type CatalogResult = { catalog: StarterCatalog | null; error: string | null }

let cached: { key: string; at: number; result: CatalogResult } | null = null

export function clearStarterCatalogCache(): void {
  cached = null
}

export function starterCatalogConfig(event: H3Event): { url: string | null; publicKey: string } {
  const rc = useRuntimeConfig(event) as { startersCatalogUrl?: string; startersPublicKey?: string }
  const raw = (rc.startersCatalogUrl ?? DEFAULT_STARTERS_CATALOG_URL).trim()
  const url = raw === '' || raw === 'off' ? null : raw
  return { url, publicKey: (rc.startersPublicKey || DEFAULT_STARTERS_PUBLIC_KEY).trim() }
}

/** https only, except a local catalog for testing (`http://localhost:…`). */
export function isAllowedCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.username || u.password) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/** Verifies a published catalog.json's text and returns its starters. Throws a readable Error. */
export async function verifyStarterCatalog(text: string, publicKey: string): Promise<StarterCatalogEntry[]> {
  let file
  try {
    file = starterCatalogFileSchema.parse(JSON.parse(text))
  } catch {
    throw new Error('The starter catalog is not in the expected format.')
  }
  let ok: boolean
  try {
    const key = await crypto.subtle.importKey('spki', base64ToBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, base64ToBytes(file.signature), catalogSigningInput(file.payload))
  } catch {
    ok = false
  }
  if (!ok) throw new Error('The starter catalog\'s signature does not match, so it was not used.')
  let payload
  try {
    payload = starterCatalogPayloadSchema.parse(JSON.parse(file.payload))
  } catch {
    throw new Error('The starter catalog is not in the expected format.')
  }
  // One entry per id: the first wins (the build script never writes duplicates).
  const seen = new Set<string>()
  return payload.starters.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

export async function getStarterCatalog(event: H3Event): Promise<CatalogResult> {
  const { url, publicKey } = starterCatalogConfig(event)
  if (!url) return { catalog: null, error: null }
  const key = `${url}|${publicKey}`
  if (cached && cached.key === key && Date.now() - cached.at < (cached.result.error ? ERROR_CACHE_MS : CACHE_MS)) {
    return cached.result
  }
  let result: CatalogResult
  try {
    if (!isAllowedCatalogUrl(url)) throw new Error('The starter catalog address must use https.')
    const res = await withTimeout(fetch(url, { headers: { accept: 'application/json' } }), FETCH_TIMEOUT_MS, 'starter catalog')
    if (!res.ok) throw new Error(`The starter catalog could not be loaded (HTTP ${res.status}).`)
    const text = await res.text()
    if (text.length > MAX_CATALOG_BYTES) throw new Error('The starter catalog is too large.')
    result = { catalog: { url, starters: await verifyStarterCatalog(text, publicKey) }, error: null }
  } catch (err) {
    const message = err instanceof Error && err.message.startsWith('The starter catalog')
      ? err.message
      : 'The starter catalog could not be reached right now.'
    console.warn('[starters] catalog unavailable:', err instanceof Error ? err.message : err)
    result = { catalog: null, error: message }
  }
  cached = { key, at: Date.now(), result }
  return result
}

/**
 * Downloads one file the catalog lists and checks its size and SHA-256. The path was
 * validated as relative and `..`-free, so it can only resolve under the catalog's folder.
 */
export async function fetchStarterFile(catalogUrl: string, file: { path: string; sha256: string; size: number }): Promise<Uint8Array> {
  const url = new URL(file.path, catalogUrl)
  if (!isAllowedCatalogUrl(url.toString())) throw new Error('Starter file address is not allowed.')
  const res = await withTimeout(fetch(url), 30_000, 'Timed out downloading a starter file.')
  if (!res.ok) throw new Error(`Couldn't download ${file.path} (HTTP ${res.status}).`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength !== file.size || bufferToHex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256) {
    throw new Error(`${file.path} doesn't match the catalog's checksum, so it was not used.`)
  }
  return bytes
}
