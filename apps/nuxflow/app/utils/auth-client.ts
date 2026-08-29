import { createAuthClient } from 'better-auth/client'
import { passkeyClient } from '@better-auth/passkey/client'

// Resolves the current request's real origin so multi-site custom domains each
// get their own correct auth baseURL. Order matters: window.location.origin is
// authoritative in the browser; useRequestURL().origin is authoritative during
// SSR; ctx-less runtimeConfig.public.siteUrl is the last-resort fallback when
// neither is available. Ported verbatim from the old app/auth.config.ts.
function resolveAuthOrigin(): string {
  let origin = useRuntimeConfig().public.siteUrl as string

  if (typeof window !== 'undefined') {
    try { origin = window.location.origin } catch { /* keep runtimeConfig fallback */ }
  }

  try {
    const activeOrigin = useRequestURL().origin
    if (activeOrigin && activeOrigin.startsWith('http')) {
      origin = activeOrigin
    }
  } catch { /* keep window.location.origin or runtimeConfig fallback */ }

  try { origin = new URL(origin).origin } catch { /* keep as-is */ }
  return origin
}

export function createNuxflowAuthClient() {
  return createAuthClient({
    baseURL: `${resolveAuthOrigin()}/api/auth`,
    plugins: [
      passkeyClient(),
    ],
  })
}

export type NuxflowAuthClient = ReturnType<typeof createNuxflowAuthClient>
