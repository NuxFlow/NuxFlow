import { getPoolId, POOL_ID_RE } from '../utils/control-plane'
import { isCentralAuth } from '../utils/accounts-origin'

/**
 * A member pool (NUXT_POOL_ID set — utils/control-plane.ts) that's set up wrong serves
 * nothing rather than half-working: a pool without the control plane's sign-in domain
 * would fall back to signing people in on its sites' own domains, from its own D1.
 * Does nothing on an ordinary install.
 */
export function poolConfigProblem(): string | null {
  const poolId = getPoolId()
  if (poolId === null) return null
  if (!POOL_ID_RE.test(poolId)) return `NUXT_POOL_ID "${poolId}" must be lower-case letters, digits and dashes.`
  if (!isCentralAuth()) return 'A pool needs NUXT_PUBLIC_ACCOUNTS_URL set to the control plane\'s sign-in domain.'
  return null
}

export default defineEventHandler((event) => {
  const problem = poolConfigProblem()
  if (!problem) return
  console.error(`[pool] Misconfigured, refusing requests: ${problem}`)
  setResponseStatus(event, 503)
  setHeader(event, 'Content-Type', 'application/json')
  return { statusCode: 503, statusMessage: 'This server is not set up correctly.' }
})
