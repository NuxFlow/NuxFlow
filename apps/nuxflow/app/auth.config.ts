import { defineClientAuth } from '@onmax/nuxt-better-auth/config'

export default defineClientAuth((ctx) => {
  // nuxt-site-config (via nuxt-seo-utils) sets runtimeConfig.public.siteUrl to
  // the current request URL, which can include a path (e.g. /setup). better-auth's
  // withPath() skips appending /api/auth when the URL already has a path, so
  // the session endpoint ends up at /setup/get-session instead of /api/auth/get-session.
  // Stripping to the origin here prevents that.
  let origin = ctx.siteUrl
  try { origin = new URL(ctx.siteUrl).origin } catch { /* keep as-is */ }
  return { baseURL: `${origin}/api/auth` }
})
