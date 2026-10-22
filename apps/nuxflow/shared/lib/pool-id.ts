/**
 * A member pool's id (NUXT_POOL_ID — server/utils/control-plane.ts): lower-case letters,
 * digits and dashes, since `pnpm pool:create` (scripts/pools/) builds Worker, D1 and KV
 * names from it.
 */
export const POOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/

/**
 * The control plane's (and the router's) service binding to a pool: POOL_CLIENTX for
 * "clientx" (dashes become underscores). server/utils/pools.ts finds pools by this prefix.
 */
export function poolBindingName(poolId: string): string {
  return `POOL_${poolId.toUpperCase().replace(/-/g, '_')}`
}

/**
 * The site directory's KV key for an address served by a member pool; the value is the
 * pool id. Written by the control plane (server/utils/site-directory.ts), read by the
 * front-door router (workers/router). An address with no key belongs to the control plane.
 */
export function directoryKey(hostname: string): string {
  return `pool-route:${normalizeHostname(hostname)}`
}

/** Lower-case, no port, no trailing dot — how a Host header is compared with a site's domain. */
export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}
