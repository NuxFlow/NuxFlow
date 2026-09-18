import 'reflect-metadata'
import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { eq, and } from 'drizzle-orm'
import * as schema from '@nuxflow/db/schema'
import { nuxflowPasswordHasher } from './pw'
import { createIsolateCache } from './isolate-cache'

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
const _cachedBetterAuth = createIsolateCache<Awaited<ReturnType<typeof buildBetterAuthInstance>>>(5 * 60 * 1000)

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

  // Whether this is a local dev deployment is a property of the *deployment*, not
  // of any single request: it must NOT be derived from the current request's Host
  // header. Nitro dispatches internal self-fetches (e.g. app/middleware/session.global.ts's
  // SSR session check, which runs on every page load) without forwarding the real
  // Host unless the caller explicitly passes it — it otherwise defaults to
  // "localhost", even inside a fully deployed production Worker. An earlier
  // version of this function branched baseURL/cookie-protocol on
  // requestHostname === 'localhost', which made those internal SSR calls
  // intermittently flip into non-secure-cookie mode: they'd look for the session
  // under the wrong cookie name, fail to find it, and clear it — sign-in would
  // succeed, then the very next page's SSR session check would silently invalidate
  // it. A genuine local dev database always has its own site domain set to
  // "localhost" (see server/api/v1/setup/complete.post.ts), which production never
  // does — that's a stable, request-independent signal.
  const sites = await db.query.sites.findMany({ columns: { domain: true } })
  const siteDomains = sites.map(s => s.domain).filter(Boolean) as string[]
  const isLocalDeployment = siteDomains.some(d => d === 'localhost' || d === '127.0.0.1' || d === '::1')

  const primaryConfiguredUrl = (config.public.siteUrl || 'https://nuxflow.dev').replace(/\/$/, '')

  // Passkeys are WebAuthn relying-party scoped — bind them to the browser's actual
  // origin. `wrangler dev` always performs a production-mode build (see CLAUDE.md),
  // so NODE_ENV can't detect local dev either, and config.public.siteUrl is a static
  // deployment-wide value that never matches the floating localhost port dev runs
  // on. Per-request Host is safe to use here specifically because a passkey
  // ceremony only ever originates from a genuine top-level/XHR browser request —
  // never from Nitro's internal self-fetches — so it isn't exposed to the
  // inconsistency described above. Gated on isLocalDeployment so a production
  // request can never be misread as local dev just because some internal call
  // happens to present Host: localhost.
  const requestIsLoopback = requestHostname === 'localhost' || requestHostname === '127.0.0.1' || requestHostname === '::1'
  const primaryUrl = (isLocalDeployment && requestIsLoopback)
    ? `${requestProto ?? 'http'}://${requestHost}`
    : primaryConfiguredUrl

  let passkeyRpID: string | undefined
  let passkeyOrigin: string | undefined
  try {
    const u = new URL(primaryUrl)
    passkeyRpID = u.hostname
    passkeyOrigin = u.origin
  }
  catch { /* passkey falls back to Better Auth's resolved baseURL */ }

  // allowedHosts/protocol are computed once from stable, request-independent
  // sources (the sites table + the deployment's configured URL) so every build
  // — real request or internal self-fetch alike — resolves identically.
  const domains = new Set(siteDomains)
  try {
    const configuredHost = new URL(primaryConfiguredUrl).hostname
    if (configuredHost) domains.add(configuredHost)
  }
  catch { /* ignore malformed URL */ }

  const baseURL: { allowedHosts: string[]; protocol: 'https' | 'http' | 'auto'; fallback: string } = {
    allowedHosts: [...domains],
    protocol: isLocalDeployment ? 'http' : 'https',
    fallback: primaryUrl,
  }

  // Shared by sendResetPassword and sendVerificationEmail below — both need the same
  // "resolve the site for this email link's host, then decrypt its email-provider
  // settings" lookup, previously only written once for sendResetPassword.
  async function resolveSiteEmailSettings(host: string): Promise<{ siteId: string; sm: Record<string, string> } | null> {
    const site = await db.query.sites.findFirst({ where: eq(schema.sites.domain, host) })
    if (!site) return null
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
    return { siteId: site.id, sm }
  }

  return betterAuth({
    baseURL,
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
          const resolved = await resolveSiteEmailSettings(host)
          if (!resolved) {
            console.warn('[auth] sendResetPassword: no site found for host', host)
            return
          }
          const { sm } = resolved
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
      // Without this, completing a "Forgot password" reset leaves any existing session
      // cookie (e.g. one an attacker stole) valid until natural expiry — defeating the
      // exact scenario password reset exists to recover from. The self-service
      // change-password flow already does this via `revokeOtherSessions: true` on its own
      // /api/auth/change-password call (see app/pages/admin/settings/index.vue); this is
      // Better Auth's equivalent for the reset-password path, which has no per-call
      // opt-in and is off by default.
      revokeSessionsOnPasswordReset: true,
    },
    // Sending is wired up (used explicitly by server/api/public/auth/register.post.ts
    // right after it creates a self-registered account) but nothing enforces it —
    // emailAndPassword above has no requireEmailVerification flag. Every existing row
    // in every existing NuxFlow deployment has emailVerified=false (there was never a
    // way to set it true before this), so flipping on a hard login block would lock out
    // every current user, including site admins, the moment this ships. sendOnSignUp is
    // deliberately omitted too: it would fire through auth.api.signUpEmail(), which is
    // also what server/api/v1/users/index.post.ts uses to create a brand-new invitee's
    // account — that route already sends its own "set your password" email right after,
    // and a second "verify your email" email pointing at a login they can't use yet
    // would recreate the exact dead-end that invite flow's own comments call out.
    emailVerification: {
      sendVerificationEmail: async ({ user, url: verifyUrl }) => {
        let host = 'localhost'
        try { host = new URL(verifyUrl).hostname } catch { /* keep default */ }
        try {
          const resolved = await resolveSiteEmailSettings(host)
          if (!resolved) {
            console.warn('[auth] sendVerificationEmail: no site found for host', host)
            return
          }
          const { sm } = resolved
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
              subject: 'Verify your email address',
              html: `<p>Hi ${escapeHtml(user.name)},</p><p>Click the link below to verify your email address.</p><p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></p><p style="color:#6b7280;font-size:14px;">If you did not create this account, you can safely ignore this email.</p>`,
              text: `Hi ${user.name},\n\nVerify your email address:\n${verifyUrl}\n\nIf you did not create this account, ignore this email.`,
            },
            event,
          )
        }
        catch (err) {
          console.error('[auth] sendVerificationEmail failed:', err)
        }
      },
      autoSignInAfterVerification: true,
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
        // true, not false: this is a narrower, different decision than the "don't force
        // email verification to log in" call documented above — it only governs whether
        // an OAuth sign-in is allowed to silently attach itself to an EXISTING
        // local-password account sharing that email, not whether existing users can log
        // in. With this false, on a site with both public self-registration and
        // Google/GitHub login enabled, an attacker could pre-register a local account
        // using a victim's real email (self-registration proves nothing — emailVerified
        // stays false, but the account is fully usable), then wait for the real victim to
        // "Sign in with Google" with that same, Google-verified email: auto-linking would
        // attach the OAuth identity onto the attacker's existing row, and the attacker's
        // original password would keep working against that now-shared account — a
        // pre-account-takeover. Setting this true means an unverified local account never
        // gets treated as "the same person" for linking purposes, closing that path. Same
        // vulnerability class as the (patched, in this project's better-auth version)
        // CVE-2026-53516, but reachable here at the application-config level regardless
        // of library patch version.
        requireLocalEmailVerified: true,
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
  const cached = _cachedBetterAuth.get(host)
  if (cached) return cached
  const instance = await buildBetterAuthInstance(event)
  _cachedBetterAuth.set(host, instance)
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

