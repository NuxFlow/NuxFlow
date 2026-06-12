import { defineClientAuth } from '@onmax/nuxt-better-auth/config'
import { passkeyClient } from '@better-auth/passkey/client'

export default defineClientAuth((ctx) => {
  // Start with the baked-in primary domain from NUXT_PUBLIC_SITE_URL.
  let origin = ctx.siteUrl

  // On the browser, window.location.origin is always the authoritative current
  // domain. Use it as the primary source so that secondary custom domains (e.g.
  // macmillanit.co.uk) get the correct auth baseURL rather than the primary domain.
  if (typeof window !== 'undefined') {
    try { origin = window.location.origin } catch { /* keep ctx.siteUrl */ }
  }

  // During SSR, useRequestURL() gives us the actual request origin. This also
  // handles the case where the browser check above wasn't available.
  try {
    const activeOrigin = useRequestURL().origin
    if (activeOrigin && activeOrigin.startsWith('http')) {
      origin = activeOrigin
    }
  } catch { /* keep window.location.origin or ctx.siteUrl */ }

  try { origin = new URL(origin).origin } catch { /* keep as-is */ }
  return {
    baseURL: `${origin}/api/auth`,
    plugins: [
      passkeyClient(),
    ],
  }
})
