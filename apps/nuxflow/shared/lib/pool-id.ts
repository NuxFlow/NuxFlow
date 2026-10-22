/**
 * A member pool's id (NUXT_POOL_ID — server/utils/control-plane.ts): lower-case letters,
 * digits and dashes, since `pnpm pool:create` (scripts/pools/) builds Worker, D1 and KV
 * names from it.
 */
export const POOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/

/**
 * The control plane's service binding to a pool: POOL_CLIENTX for "clientx" (dashes become
 * underscores). server/utils/pools.ts finds pools by this prefix.
 */
export function poolBindingName(poolId: string): string {
  return `POOL_${poolId.toUpperCase().replace(/-/g, '_')}`
}
