import 'reflect-metadata'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import * as schema from '@nuxflow/db/schema'
import { getD1 } from './utils/db'
import { passkey } from '@better-auth/passkey'
import { eq } from 'drizzle-orm'
import { nuxflowPasswordHasher } from './utils/pw'

// NOTE ON WHY THIS FILE IS SMALLER THAN IT LOOKS LIKE IT SHOULD BE:
//
// This instance (built by @onmax/nuxt-better-auth's defineServerAuth) is never
// actually used to serve /api/auth/** traffic — server/middleware/04.auth-override.ts
// intercepts every /api/auth/** request before Nitro route resolution and hands it to
// the real instance in server/utils/better-auth.ts instead (see that file's own
// comment). This file only exists because the Nuxt module needs *some* config
// returned from defineServerAuth() to bootstrap its client-side composables
// (useUserSession(), signIn(), the passkey client's types, etc.).
//
// socialProviders, the custom emailAndPassword.sendResetPassword handler, and
// account.accountLinking used to be duplicated here as well as in better-auth.ts —
// two copies of the same config that could (and once did) silently drift apart
// and break session validation in production. They were removed from this file
// entirely rather than kept in sync: real Google/GitHub sign-in, password-reset
// emails, and account linking are handled exclusively by better-auth.ts's instance,
// so a second copy here was never anything but a liability. Don't re-add them here.
export default defineServerAuth((ctx) => {
  const config = ctx.runtimeConfig as {
    public?: { siteUrl?: string }
  }

  // Dynamically resolve request host and protocol from the active H3 event to support multi-site custom domains.
  let activeOrigin = ''
  try {
    const event = useEvent()
    if (event) {
      let host = getHeader(event, 'host')?.split(':')[0] ?? ''
      if (host === '127.0.0.1' || host === '::1') {
        host = 'localhost'
      }
      if (host && host !== 'localhost') {
        const proto = getHeader(event, 'x-forwarded-proto') || 'https'
        activeOrigin = `${proto}://${host}`
      }
    }
  } catch {
    /* keep empty fallback */
  }

  const siteUrl = (activeOrigin || config.public?.siteUrl || '').replace(/\/$/, '')
  let passkeyRpID: string | undefined
  let passkeyOrigin: string | undefined
  if (siteUrl) {
    try {
      passkeyRpID = new URL(siteUrl).hostname
      passkeyOrigin = siteUrl
    }
    catch { /* malformed URL — passkey falls back to Better Auth base URL */ }
  }

  // D1 is cached into getD1() by the 01.d1-cache middleware which runs for every
  // request before this callback is invoked. The result is cached per-siteUrl by
  // the nuxt-better-auth runtime so this runs once per CF Workers isolate.
  const d1 = getD1()
  if (!d1) {
    throw new Error('Better Auth requires a D1 database binding (DB). Run via `wrangler dev` or deploy with the DB binding configured in wrangler.toml.')
  }
  const db = drizzleD1(d1 as Parameters<typeof drizzleD1>[0], { schema })

  return {
    baseURL: siteUrl || undefined,
    advanced: {
      trustedProxyHeaders: true,
    },
    trustedOrigins: async (request) => {
      if (!request) return []
      try {
        const url = new URL(request.url)
        const host = url.hostname
        const origin = url.origin

        // Always trust loopback for dev
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
          return [origin]
        }

        // Query the database to check if this domain is registered
        const site = await db.query.sites.findFirst({
          where: eq(schema.sites.domain, host)
        })

        if (site) {
          return [
            origin,
            origin.replace(/^https:/, 'http:'),
            origin.replace(/^http:/, 'https:')
          ]
        }
      } catch (err) {
        console.error('Error verifying trusted origin:', err)
      }
      return []
    },
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        passkey: schema.passkeys,
      },
      usePlural: false,
      // @ts-expect-error — DrizzleAdapterConfig doesn't type `experimental.joins` yet; valid at runtime
      experimental: { joins: true },
      // D1 does not support interactive transactions — disable so the adapter
      // uses individual statements instead of wrapping in BEGIN/COMMIT.
      transaction: false,
    }),
    // No sendResetPassword handler here — this instance never receives a real
    // /api/auth/forget-password request (04.auth-override.ts always routes it to
    // better-auth.ts's instance first), so a handler here would just be dead code.
    emailAndPassword: {
      enabled: true,
      password: nuxflowPasswordHasher,
    },
    // No account.accountLinking here — see the file-level note above; real account
    // linking is configured on better-auth.ts's instance only.
    //
    // socialProviders below is TYPE SCAFFOLDING ONLY, not live config: the client's
    // signIn.social() infers its provider-name union from this instance's configured
    // provider keys, so removing this block entirely breaks that type (provider
    // narrows to `never` in login.vue/register.vue) even though the empty
    // clientId/clientSecret values here are never read for a real request — real
    // credentials live exclusively in better-auth.ts's instance.
    socialProviders: {
      google: { clientId: '', clientSecret: '', enabled: false },
      github: { clientId: '', clientSecret: '', enabled: false },
    },
    plugins: [
      passkey({
        rpName: 'NuxFlow',
        ...(passkeyRpID && { rpID: passkeyRpID }),
        ...(passkeyOrigin && { origin: passkeyOrigin }),
      }),
    ],
  }
})
