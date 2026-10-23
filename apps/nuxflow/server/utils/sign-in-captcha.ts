import type { H3Event } from 'h3'
import { resolveStringSetting, resolveBooleanSetting } from './settings'
import { eventForSite, getPrimarySite } from './site-info'
import { getTurnstileSecret } from './turnstile'

/**
 * Turnstile on password sign-in and password-reset requests — opt-in, deployment-wide.
 *
 * Why: every password sign-in attempt runs Argon2 (~150-175 ms of CPU and ~19 MiB of
 * memory), including attempts for emails that don't exist (Better Auth hashes anyway, so
 * response timing can't reveal which emails have accounts). 04.auth-override.ts limits
 * attempts per IP, but credential stuffing spread across many IPs gets past that. A
 * Turnstile check runs before Better Auth's handler, so a bot without a valid token never
 * reaches the hash at all.
 *
 * Sign-in is one place for the whole deployment (the accounts origin, or the single site),
 * so this is configured on the primary site: its `integrations.turnstile_site_key`, the
 * deployment's CLOUDFLARE_TURNSTILE_SECRET_KEY, and the `auth.turnstile_sign_in` switch
 * (Settings → Integrations there). All three are required — the switch exists because
 * a widget whose allowed hostnames don't include the sign-in hostname would otherwise
 * lock everyone out of password sign-in the moment a site key was saved. If that happens
 * anyway, passkeys still work, and removing the secret turns this off.
 *
 * Used by better-auth.ts (to require it) and GET /api/v1/auth/captcha (to show the
 * widget) — both from this one function so the two can't disagree.
 */
export async function getSignInCaptcha(event: H3Event): Promise<{ siteKey: string; secretKey: string } | null> {
  const secretKey = getTurnstileSecret()
  if (!secretKey) return null

  const primary = await getPrimarySite(event)
  if (!primary) return null
  const siteEvent = eventForSite(event, primary.id)
  const [enabled, siteKey] = await Promise.all([
    resolveBooleanSetting(siteEvent, 'auth.turnstile_sign_in'),
    resolveStringSetting(siteEvent, 'integrations.turnstile_site_key'),
  ])
  if (!enabled || !siteKey) return null
  return { siteKey, secretKey }
}

/** The Better Auth endpoints the check applies to — the two a bot can call without a session. */
export const SIGN_IN_CAPTCHA_ENDPOINTS = ['/sign-in/email', '/request-password-reset']
