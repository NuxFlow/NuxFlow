import 'reflect-metadata'
import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { eq } from 'drizzle-orm'
import * as schema from '@nuxflow/db/schema'
import { nuxflowPasswordHasher } from './pw'
import { createIsolateCache } from './isolate-cache'
import { renderEmailTemplate, type EmailTemplateInput } from './email-template'
import { loadEmailConfig, sendEmailWithConfig } from './email'
import { currentAuthEvent } from './auth-request-context'
import { alertOnNewSignIn, alertForAuthPath } from './security-alerts'
import { waitUntil } from './cf-env'
import { getAccountsOrigin } from './accounts-origin'
import { activatePendingInvitations } from './invitations'
import { clearCachedRole } from './role-cache'
import { getPrimarySite, eventForSite } from './site-info'

// Auth instance cache with 5-minute TTL so newly-registered custom domains and
// social-login credential changes start working without a redeployment. Under central
// sign-in there is one instance for the deployment. Otherwise it's keyed by Host: in
// same-origin mode baseURL/passkey origin follow the site's own domain, and
// /api/auth/** bypasses multi-site resolution, so the Host header (free to read, no D1
// round trip) is the stable key.
const _cachedBetterAuth = createIsolateCache<Awaited<ReturnType<typeof buildBetterAuthInstance>>>(5 * 60 * 1000)

async function buildBetterAuthInstance(event: H3Event) {
  const config = useRuntimeConfig(event)
  const db = useDb(event)

  const requestHost = getHeader(event, 'host')
  const requestProto = getHeader(event, 'x-forwarded-proto')
  const requestHostname = requestHost?.split(':')[0] ?? ''

  // Social sign-in is one OAuth app for the whole deployment: configured on the primary
  // (operator's) site — Admin → Settings → Integrations there — with the env vars as the
  // fallback. Under central sign-in every OAuth callback lands on the accounts origin, so
  // one app with one callback URL serves every site; per-site OAuth apps no longer exist.
  const primary = await getPrimarySite(event)
  const settingsEvent = primary ? eventForSite(event, primary.id) : event
  const [googleClientId, googleClientSecret, githubClientId, githubClientSecret] = await Promise.all([
    resolveSetting(settingsEvent, 'auth.google_client_id', 'googleClientId'),
    resolveSetting(settingsEvent, 'auth.google_client_secret', 'googleClientSecret'),
    resolveSetting(settingsEvent, 'auth.github_client_id', 'githubClientId'),
    resolveSetting(settingsEvent, 'auth.github_client_secret', 'githubClientSecret'),
  ])

  const accountsOrigin = getAccountsOrigin()

  // Where Better Auth lives, and what WebAuthn binds passkeys to.
  //
  // Central sign-in (NUXT_PUBLIC_ACCOUNTS_URL): one fixed origin. Every sign-in, reset
  // link, OAuth callback and passkey ceremony happens there, so passkeys (rpID = the
  // accounts host) work for every site, and nothing Better Auth serves is reachable on a
  // site's own domain (03.accounts-routing.ts).
  //
  // Same-origin (single-site install): the site's own domain, as before.
  let baseURL: string | { allowedHosts: string[]; protocol: 'https' | 'http' | 'auto'; fallback: string }
  let passkeyRpID: string | undefined
  let passkeyOrigin: string | undefined
  let trustedOrigins: (request?: Request) => Promise<string[]>

  if (accountsOrigin) {
    baseURL = accountsOrigin
    passkeyRpID = new URL(accountsOrigin).hostname
    passkeyOrigin = accountsOrigin
    trustedOrigins = async () => [accountsOrigin]
  }
  else {
    // Whether this is a local dev deployment is a property of the *deployment*, not of
    // any single request: Nitro dispatches internal self-fetches (e.g.
    // app/middleware/01.session.global.ts's SSR session check) with Host "localhost"
    // unless the caller forwards the real one, even inside a deployed Worker — branching
    // cookie security on the request host once made those calls silently clear real
    // sessions. A genuine local dev database always has its site domain set to
    // "localhost" (setup/complete.post.ts), which production never does.
    const sites = await db.query.sites.findMany({ columns: { domain: true } })
    const siteDomains = sites.map(s => s.domain).filter(Boolean) as string[]
    const isLocalDeployment = siteDomains.some(d => d === 'localhost' || d === '127.0.0.1' || d === '::1')
    const primaryConfiguredUrl = (config.public.siteUrl || `https://${siteDomains[0] ?? 'localhost'}`).replace(/\/$/, '')

    // Locally, bind passkeys to the browser's real origin (the floating dev port) — safe
    // because a passkey ceremony only ever comes from a genuine browser request, never
    // from Nitro's internal self-fetches, and gated on isLocalDeployment so production
    // can't be misread as local dev.
    const requestIsLoopback = requestHostname === 'localhost' || requestHostname === '127.0.0.1' || requestHostname === '::1'
    const primaryUrl = (isLocalDeployment && requestIsLoopback)
      ? `${requestProto ?? 'http'}://${requestHost}`
      : primaryConfiguredUrl
    try {
      const u = new URL(primaryUrl)
      passkeyRpID = u.hostname
      passkeyOrigin = u.origin
    }
    catch { /* passkey falls back to Better Auth's resolved baseURL */ }

    const domains = new Set(siteDomains)
    try {
      const configuredHost = new URL(primaryConfiguredUrl).hostname
      if (configuredHost) domains.add(configuredHost)
    }
    catch { /* ignore malformed URL */ }
    baseURL = {
      allowedHosts: [...domains],
      protocol: isLocalDeployment ? 'http' : 'https',
      fallback: primaryUrl,
    }
    trustedOrigins = async (request) => {
      if (!request) return []
      try {
        const url = new URL(request.url)
        const host = url.hostname
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return [url.origin]
        // Only the scheme the request actually arrived on — never also its http://
        // variant, which would undercut https-only expectations for no legitimate reason.
        const site = await db.query.sites.findFirst({ where: eq(schema.sites.domain, host) })
        if (site) return [url.origin]
      }
      catch (err) {
        console.error('[auth] trusted origin check failed:', err)
      }
      return []
    }
  }

  /**
   * The site an auth email is about. Links carry it as `site=<id>` on their callback URL
   * (see sendSetPasswordEmail / registerAccountForSite), since under central sign-in every
   * link points at the accounts origin, not the site. Otherwise (same-origin install) the
   * link's own host names the site; failing both, the primary site.
   */
  async function resolveEmailSite(linkUrl: string): Promise<{ id: string; name: string; domain: string } | null> {
    try {
      const link = new URL(linkUrl)
      const callback = link.searchParams.get('callbackURL')
      const siteId = callback ? new URL(callback, link.origin).searchParams.get('site') : null
      if (siteId) {
        const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, siteId), columns: { id: true, name: true, domain: true } })
        if (site) return site
      }
      const byHost = await db.query.sites.findFirst({ where: eq(schema.sites.domain, link.hostname), columns: { id: true, name: true, domain: true } })
      if (byHost) return byHost
    }
    catch { /* malformed link — fall through */ }
    return getPrimarySite(event)
  }

  function linkPurpose(linkUrl: string): 'invite' | 'reset' {
    try {
      const link = new URL(linkUrl)
      const callback = link.searchParams.get('callbackURL')
      return callback && new URL(callback, link.origin).searchParams.get('purpose') === 'invite' ? 'invite' : 'reset'
    }
    catch { return 'reset' }
  }

  // Shared by sendResetPassword and sendVerificationEmail below: sends through the email
  // settings of the site the link is about (see resolveEmailSite), branded as that site.
  async function sendAuthEmail(linkUrl: string, opts: { name: string; to: string; subject: string; template: Omit<EmailTemplateInput, 'siteName' | 'accentColor'> }): Promise<void> {
    try {
      const site = await resolveEmailSite(linkUrl)
      if (!site) {
        console.warn(`[auth] ${opts.name}: no site to send as`)
        return
      }
      const siteEvent = eventForSite(event, site.id)
      const emailConfig = await loadEmailConfig(siteEvent)
      const accent = await resolveSetting(siteEvent, 'theme.primary_color')
      const { html, text } = renderEmailTemplate({
        ...opts.template,
        siteName: site.name,
        accentColor: typeof accent === 'string' ? accent : undefined,
      })
      await sendEmailWithConfig(
        { ...emailConfig, domain: site.domain, fromAddress: emailConfig.fromAddress || `noreply@${site.domain.replace(/^www\./, '')}` },
        { to: opts.to, subject: opts.subject, html, text, category: 'auth' },
        siteEvent,
      )
    }
    catch (err) {
      console.error(`[auth] ${opts.name} failed:`, err)
    }
  }

  return betterAuth({
    baseURL,
    secret: config.betterAuthSecret,
    advanced: { trustedProxyHeaders: true },
    trustedOrigins,
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
        if (linkPurpose(resetUrl) === 'invite') {
          // The same single-use reset token, worded as an invitation — it's how an invitee
          // proves they own the mailbox (see sendSetPasswordEmail in user-provisioning.ts).
          const site = await resolveEmailSite(resetUrl)
          const siteName = site?.name ?? 'the site'
          await sendAuthEmail(resetUrl, {
            name: 'sendResetPassword(invite)',
            to: user.email,
            subject: `You've been invited to ${siteName}`,
            template: {
              heading: `You've been invited to ${siteName}`,
              preheader: 'Set your password to accept. This link expires in 1 hour.',
              paragraphs: [`Hi ${user.name},`, `You've been invited to join ${siteName}. Choose a password to accept the invitation and sign in. This link expires in 1 hour — ask whoever invited you to resend it if it runs out.`],
              action: { label: 'Accept invitation', url: resetUrl },
              footnote: 'If you weren\'t expecting this, you can ignore it — nothing changes unless you use the link.',
            },
          })
          return
        }
        await sendAuthEmail(resetUrl, {
          name: 'sendResetPassword',
          to: user.email,
          subject: 'Reset your password',
          template: {
            heading: 'Reset your password',
            preheader: 'This link expires in 1 hour.',
            paragraphs: [`Hi ${user.name},`, 'Use the button below to choose a new password. This link expires in 1 hour.'],
            action: { label: 'Reset password', url: resetUrl },
            footnote: 'If you did not request this, you can safely ignore this email — your password will not change.',
          },
        })
      },
      // Without this, completing a "Forgot password" reset leaves any existing session
      // cookie (e.g. one an attacker stole) valid until natural expiry — defeating the
      // exact scenario password reset exists to recover from. The self-service
      // change-password flow already does this via `revokeOtherSessions: true` on its own
      // /api/auth/change-password call (see app/pages/admin/settings/index.vue); this is
      // Better Auth's equivalent for the reset-password path, which has no per-call
      // opt-in and is off by default.
      revokeSessionsOnPasswordReset: true,
      // A completed reset proves the person controls the mailbox (the token was only ever
      // emailed there), so it doubles as email verification — and it's how invitees and
      // reclaimed accounts (user-provisioning.ts) finish claiming their account. When the
      // address was NOT yet verified, anything registered on the account before this
      // point may belong to someone who pre-registered the address, so passkeys are
      // dropped too (sessions are already revoked by revokeSessionsOnPasswordReset).
      onPasswordReset: async ({ user }) => {
        const requestEvent = currentAuthEvent()
        if (requestEvent) {
          waitUntil(requestEvent, alertForAuthPath(requestEvent, user.id, '/api/auth/reset-password')
            .catch(err => console.error('[auth] Password-reset alert failed:', err)))
        }
        // Completing the emailed link proves mailbox ownership and replaces the password,
        // so any pending invitations (site_invitations — held for an account nobody had
        // proven they own) become real roles now.
        const activated = await activatePendingInvitations(db, user.id)
        for (const siteId of activated) clearCachedRole(user.id, siteId)
        if (user.emailVerified) return
        await db.delete(schema.passkeys).where(eq(schema.passkeys.userId, user.id))
        await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, user.id))
      },
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
        await sendAuthEmail(verifyUrl, {
          name: 'sendVerificationEmail',
          to: user.email,
          subject: 'Verify your email address',
          template: {
            heading: 'Verify your email address',
            paragraphs: [`Hi ${user.name},`, 'Confirm this is your email address by using the button below.'],
            action: { label: 'Verify email', url: verifyUrl },
            footnote: 'If you did not create this account, you can safely ignore this email.',
          },
        })
      },
      autoSignInAfterVerification: true,
    },
    // New-device sign-in alerts. Runs in the background on the live request (see
    // auth-request-context.ts); sessions created outside an /api/auth request (the invite
    // flow's in-process signUpEmail) have no request context and are skipped.
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const requestEvent = currentAuthEvent()
            if (!requestEvent) return
            waitUntil(requestEvent, alertOnNewSignIn(requestEvent, session)
              .catch(err => console.error('[auth] New sign-in alert failed:', err)))
          },
        },
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
  // Central sign-in: one instance for the whole deployment — nothing in it depends on the
  // request's host (see buildBetterAuthInstance).
  if (getAccountsOrigin()) {
    const central = _cachedBetterAuth.get('central')
    if (central) return central
    const instance = await buildBetterAuthInstance(event)
    _cachedBetterAuth.set('central', instance)
    return instance
  }

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

