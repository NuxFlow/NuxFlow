import 'reflect-metadata'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import * as schema from '@nuxflow/db/schema'
import { getD1 } from './utils/db'
import { passkey } from '@better-auth/passkey'
import { and, eq } from 'drizzle-orm'
import { sendEmailWithConfig, escapeHtml } from './utils/email'
import { decryptText } from './utils/encryption'
import { SENSITIVE_SETTING_KEYS } from './utils/settings'
import { nuxflowPasswordHasher } from './utils/pw'

export default defineServerAuth((ctx) => {
  const config = ctx.runtimeConfig as {
    googleClientId?: string
    googleClientSecret?: string
    githubClientId?: string
    githubClientSecret?: string
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
    emailAndPassword: {
      enabled: true,
      password: nuxflowPasswordHasher,
      sendResetPassword: async ({ user, url }) => {
        // Extract site host from the reset URL to resolve per-site email config.
        let host = 'localhost'
        try { host = new URL(url).hostname } catch { /* keep default */ }

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
          const secret = rc.betterAuthSecret as string
          const sm: Record<string, string> = {}
          for (const row of settingRows) {
            if (!row.value) continue
            if (SENSITIVE_SETTING_KEYS.has(row.key)) {
              try { sm[row.key] = await decryptText(row.value as string, secret) }
              catch { sm[row.key] = row.value as string }
            } else {
              sm[row.key] = row.value as string
            }
          }

          const resetEvent = useEvent()
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
              html: `<p>Hi ${escapeHtml(user.name)},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a></p><p style="color:#6b7280;font-size:14px;">If you did not request this, you can safely ignore this email.</p>`,
              text: `Hi ${user.name},\n\nReset your password:\n${url}\n\nIf you did not request this, ignore this email.`,
            },
            resetEvent,
          )
        } catch (err) {
          console.error('[auth] sendResetPassword email failed:', err)
        }
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
        // Onboarding users are created without going through email verification;
        // trust them anyway since the admin physically ran the setup wizard.
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
  }
})
