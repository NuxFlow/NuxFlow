import 'reflect-metadata'
import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { eq, and } from 'drizzle-orm'
import * as schema from '@nuxflow/db/schema'
import { nuxflowPasswordHasher } from './pw'

// Isolate-level auth instance cache with 5-minute TTL so newly-registered
// custom domains start working without a redeployment.
interface CachedBetterAuth {
  instance: Awaited<ReturnType<typeof buildBetterAuthInstance>>
  expiry: number
}
let _cachedBetterAuth: CachedBetterAuth | null = null
const BETTER_AUTH_CACHE_TTL_MS = 5 * 60 * 1000

async function buildBetterAuthInstance(event: H3Event) {
  const config = useRuntimeConfig(event)
  const db = useDb(event)

  const isDev = process.env.NODE_ENV !== 'production'
  const primaryUrl = (config.public.siteUrl || (isDev ? 'http://localhost:3000' : 'https://nuxflow.dev')).replace(/\/$/, '')

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

  if (isDev) {
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
    socialProviders: {
      google: {
        clientId: config.googleClientId ?? '',
        clientSecret: config.googleClientSecret ?? '',
        enabled: Boolean(config.googleClientId),
      },
      github: {
        clientId: config.githubClientId ?? '',
        clientSecret: config.githubClientSecret ?? '',
        enabled: Boolean(config.githubClientId),
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
  const now = Date.now()
  if (_cachedBetterAuth && now < _cachedBetterAuth.expiry) return _cachedBetterAuth.instance
  const instance = await buildBetterAuthInstance(event)
  _cachedBetterAuth = { instance, expiry: now + BETTER_AUTH_CACHE_TTL_MS }
  return instance
}
