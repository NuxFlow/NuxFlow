// Which Worker a request goes to. Kept apart from index.ts so it can be tested without a
// Workers runtime (apps/nuxflow/tests/unit/router.test.ts).
import { directoryKey, normalizeHostname, poolBindingName } from '../../../apps/nuxflow/shared/lib/pool-id'

/** What the router uses of a KV namespace. */
export interface DirectoryReader {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>
}

/** What the router uses of a service binding. */
export interface ServiceFetcher {
  fetch(request: Request): Promise<Response>
}

export interface RouterEnv {
  /** The control plane's PLUGIN_KV namespace, where it writes the site directory. */
  DIRECTORY: DirectoryReader
  /** The control plane Worker: every address the directory doesn't list. */
  CONTROL_PLANE: ServiceFetcher
  /** POOL_<ID>: one service binding per member pool (its default entrypoint). */
  [binding: string]: unknown
}

// The directory changes rarely (a site created, moved, or given a new address) — a
// minute's delay is fine, and Cloudflare keeps the answer at the edge for that long.
export const DIRECTORY_CACHE_TTL_SECONDS = 60

function isFetcher(value: unknown): value is ServiceFetcher {
  return typeof value === 'object' && value !== null && typeof (value as ServiceFetcher).fetch === 'function'
}

/**
 * The pool serving this request's address, or the control plane. Every failure falls back
 * to the control plane, which answers exactly as it did before there were pools.
 */
export async function pickTarget(request: Request, env: RouterEnv): Promise<{ target: ServiceFetcher; poolId: string | null }> {
  // The Host header first, the URL as fallback — the same header the pool's own site lookup
  // (server/middleware/02.multi-site.ts) reads, so the two can never disagree.
  const host = normalizeHostname(request.headers.get('host') || new URL(request.url).hostname)
  let poolId: string | null = null
  if (host) {
    try {
      poolId = await env.DIRECTORY.get(directoryKey(host), { cacheTtl: DIRECTORY_CACHE_TTL_SECONDS })
    } catch (err) {
      console.error(`[router] Directory lookup for ${host} failed; sending it to the control plane:`, err)
    }
  }
  if (poolId) {
    const pool = env[poolBindingName(poolId)]
    if (isFetcher(pool)) return { target: pool, poolId }
    console.error(`[router] ${host} belongs to pool "${poolId}", but this router has no ${poolBindingName(poolId)} binding; sending it to the control plane.`)
  }
  return { target: env.CONTROL_PLANE, poolId: null }
}
