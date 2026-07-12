import 'reflect-metadata'
import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { eq, and } from 'drizzle-orm'
import * as schema from '@nuxflow/db/schema'
import { nuxflowPasswordHasher } from './pw'

// Per-host auth instance cache with 5-minute TTL so newly-registered custom
// domains — and per-site social-login credential changes — start working
// without a redeployment. Keyed by Host header rather than siteId: /api/auth/**
// deliberately bypasses multi-site middleware (see server/middleware/02.multi-site.ts),
// so event.context.siteId isn't reliably set here — but the Host header always is,
// and it's free to read (no DB round-trip) so it's safe to use as the cache key
// even on the hot cache-hit path. Keyed by host rather than a single shared slot
// because socialProviders below can now differ per site — a single cache slot
// would let one site's request silently serve its Google/GitHub credentials to
// every other site sharing the isolate for the next 5 minutes.
interface CachedBetterAuth {
  instance: Awaited<ReturnType<typeof buildBetterAuthInstance>>
  expiry: number
}
const _cachedBetterAuth = new Map<string, CachedBetterAuth>()
const BETTER_AUTH_CACHE_TTL_MS = 5 * 60 * 1000

async function buildBetterAuthInstance(event: H3Event) {
  const config = useRuntimeConfig(event)
  const db = useDb(event)

  const requestHost = getHeader(event, 'host')
  const requestProto = getHeader(event, 'x-forwarded-proto')
  const requestHostname = requestHost?.split(':')[0] ?? ''

  // /api/auth/** bypasses multi-site middleware, so event.context.siteId usually
  // isn't set yet at this point — resolve it ourselves from the Host header (same
  // domain-lookup pattern already used below for trustedOrigins/sendResetPassword)
  // so resolveSetting() below can find this site's per-site setting overrides.
  // Never overwrites an already-set siteId.
  if (!event.context.siteId) {
    if (requestHostname && requestHostname !== 'localhost' && requestHostname !== '127.0.0.1' && requestHostname !== '::1') {
      const currentSite = await db.query.sites.findFirst({ where: eq(schema.sites.domain, requestHostname), columns: { id: true } })
      if (currentSite) event.context.siteId = currentSite.id
    }
  }

  const [googleClientId, googleClientSecret, githubClientId, githubClientSecret] = await Promise.all([
    resolveSetting(event, 'auth.google_client_id', 'googleClientId'),
    resolveSetting(event, 'auth.google_client_secret', 'googleClientSecret'),
    resolveSetting(event, 'auth.github_client_id', 'githubClientId'),
    resolveSetting(event, 'auth.github_client_secret', 'githubClientSecret'),
  ])

  // `wrangler dev` always performs a production-mode build (see CLAUDE.md), so
  // process.env.NODE_ENV is 'production' locally too — it cannot be used to detect
  // "am I running against a local dev server". Cloudflare's own runtime-config
  // auto-detection also isn't reliable here: config.public.siteUrl resolves to
  // workerd's own loopback bind address (e.g. http://127.0.0.1:8787) in local dev,
  // which the browser's actual origin (http://localhost:8787 — a *different*
  // hostname, even though both reach the same server) doesn't match. WebAuthn
  // requires the RP origin to equal the page's real origin, so binding passkeys to
  // either the production domain or workerd's bind address breaks them locally.
  // Instead, detect "local dev" the same way the rest of this file already does
  // (see trustedOrigins below): the incoming request's own Host header is loopback.
  const isLocalRequest = requestHostname === 'localhost' || requestHostname === '127.0.0.1' || requestHostname === '::1'
  const primaryUrl = isLocalRequest
    ? `${requestProto ?? 'http'}://${requestHost}`
    : (config.public.siteUrl || 'https://nuxflow.dev').replace(/\/$/, '')

  // Passkeys are WebAuthn relying-party scoped — bind them to the primary domain.
  // Users on secondary custom domains can still use email/password and Google/GitHub OAuth.
  let passkeyRpID: string | undefined
  let passkeyOrigin: string | undefined
  try {
    const u = new URL(primaryUrl)
    passkeyRpID = u.hostname
    passkeyOrigin = u.origin
  }
  catch { /* passkey falls back to Better Auth's resolved baseURL */ }

  // Dev: simple string baseURL (single domain). Prod: allowedHosts object so
  // Better Auth resolves redirect_uri from the incoming Host header per-request,
  // enabling correct OAuth flows on all registered custom domains.
  type BaseURLConfig = string | { allowedHosts: string[]; protocol: 'https' | 'http' | 'auto'; fallback: string }
  let baseURL: BaseURLConfig

  if (isLocalRequest) {
    baseURL = primaryUrl
  }
  else {
    const sites = await db.query.sites.findMany({ columns: { domain: true } })
    const domains = sites.map(s => s.domain).filter(Boolean) as string[]
    try {
      const primaryHost = new URL(primaryUrl).hostname
      if (primaryHost && !domains.includes(primaryHost)) domains.push(primaryHost)
    }
    catch { /* ignore malformed URL */ }

    baseURL = {
      allowedHosts: domains,
      protocol: 'https',
      fallback: primaryUrl,
    }
  }

  return betterAuth({
    baseURL: baseURL as string,
    secret: config.betterAuthSecret,
    advanced: { trustedProxyHeaders: true },
    trustedOrigins: async (request) => {
      if (!request) return []
      try {
        const url = new URL(request.url)
        const host = url.hostname
        const origin = url.origin
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return [origin]
        const site = await db.query.sites.findFirst({ where: eq(schema.sites.domain, host) })
        if (site) {
          return [origin, origin.replace(/^https:/, 'http:'), origin.replace(/^http:/, 'https:')]
        }
      }
      catch (err) {
        console.error('[auth] trusted origin check failed:', err)
      }
      return []
    },
    database: drizzleAdapter(db as Parameters<typeof drizzleAdapter>[0], {
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
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      password: nuxflowPasswordHasher,
      sendResetPassword: async ({ user, url: resetUrl }) => {
        let host = 'localhost'
        try { host = new URL(resetUrl).hostname } catch { /* keep default */ }
        try {
          const site = await db.query.sites.findFirst({ where: eq(schema.sites.domain, host) })
          if (!site) {
            console.warn('[auth] sendResetPassword: no site found for host', host)
            return
          }
          const settingRows = await db.query.siteSettings.findMany({
            where: and(eq(schema.siteSettings.siteId, site.id)),
          })
          const rc = useRuntimeConfig()
          const secret = rc.betterAuthSecret
          const sm: Record<string, string> = {}
          for (const row of settingRows) {
            if (!row.value) continue
            if (SENSITIVE_SETTING_KEYS.has(row.key)) {
              try { sm[row.key] = await decryptText(row.value as string, secret) }
              catch { sm[row.key] = row.value as string }
            }
            else {
              sm[row.key] = row.value as string
            }
          }
          await sendEmailWithConfig(
            {
              emailProvider: sm['email.provider'] || 'console',
              fromAddress: sm['email.from_address'] || `noreply@${host}`,
              resendApiKey: sm['email.resend_api_key'],
              brevoApiKey: sm['email.brevo_api_key'],
              zeptoApiKey: sm['email.zepto_api_key'],
              domain: host,
            },
            {
              to: user.email,
              subject: 'Reset your password',
              html: `<p>Hi ${escapeHtml(user.name)},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a></p><p style="color:#6b7280;font-size:14px;">If you did not request this, you can safely ignore this email.</p>`,
              text: `Hi ${user.name},\n\nReset your password:\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
            },
            event,
          )
        }
        catch (err) {
          console.error('[auth] sendResetPassword email failed:', err)
        }
      },
    },
    // Better Auth's own rate limiter defaults to in-memory storage, which doesn't
    // persist across Cloudflare Worker isolates. Rate limiting for sign-in/sign-up/
    // password-reset is instead handled in server/middleware/04.auth-override.ts
    // using the app's existing D1-backed rateLimit() utility.
    rateLimit: { enabled: false },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
        requireLocalEmailVerified: false,
      },
    },
    // Resolved via resolveSetting() above: per-site DB override first (Admin →
    // Settings → Social Login), env var fallback second — same pattern as every
    // other third-party credential in this app (media/email/AI/payments).
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        enabled: Boolean(googleClientId),
      },
      github: {
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        enabled: Boolean(githubClientId),
      },
    },
    plugins: [
      passkey({
        rpName: 'NuxFlow',
        ...(passkeyRpID && { rpID: passkeyRpID }),
        ...(passkeyOrigin && { origin: passkeyOrigin }),
      }),
    ],
  })
}

export async function getOrCreateBetterAuth(event: H3Event) {
  // Cache key is the hostname only (no port) for real requests — the production
  // baseURL/allowedHosts computation in buildBetterAuthInstance doesn't depend on
  // the request's exact Host string at all (it's derived from config + the sites
  // table), so keying on anything finer than the hostname only fragments the cache
  // for no benefit, forcing needless rebuilds (extra D1 round-trips) on every
  // request whose Host happens to vary in a way that doesn't matter.
  //
  // The one exception is local `wrangler dev`, where the origin genuinely *is*
  // derived per-request (see buildBetterAuthInstance) and the port matters for
  // WebAuthn's exact-origin check — keep the full host there, since that dev
  // server has also been observed to occasionally omit the port on some request
  // types, and keying on hostname alone would let that port-less build get cached
  // and served to later, correctly-ported requests for the rest of the TTL.
  const rawHost = getHeader(event, 'host') || 'default'
  const hostname = rawHost.split(':')[0] ?? rawHost
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  const host = isLocal ? rawHost : hostname
  const now = Date.now()
  const cached = _cachedBetterAuth.get(host)
  if (cached && now < cached.expiry) return cached.instance
  const instance = await buildBetterAuthInstance(event)
  _cachedBetterAuth.set(host, { instance, expiry: now + BETTER_AUTH_CACHE_TTL_MS })
  return instance
}

// Called after saving auth.google_client_id/secret or auth.github_client_id/secret
// (see server/api/v1/settings/index.patch.ts) so a credential change takes effect
// on the next request instead of waiting out the 5-minute TTL. Clears every host's
// entry rather than just the current site's — simplest correct option, and this
// only runs on an infrequent admin settings save, not a hot request path.
export function clearBetterAuthCache(): void {
  _cachedBetterAuth.clear()
}
