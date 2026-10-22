/**
 * A member pool's id (NUXT_POOL_ID — server/utils/control-plane.ts): lower-case letters,
 * digits and dashes, since `pnpm pool:create` (scripts/pools/) builds Worker, D1 and KV
 * names from it.
 */
export const POOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/
