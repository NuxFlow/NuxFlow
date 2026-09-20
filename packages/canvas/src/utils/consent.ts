// Shared cookie-consent contract for this codebase's two consent UIs — the global
// banner (apps/nuxflow/app/components/public/CookieConsent.vue) and this package's
// CanvasBlockGdpr block — plus the server-side script-injection gate in
// apps/nuxflow/server/plugins/site-settings-resolver.ts. Before this existed, each of
// those three places had its own cookie/localStorage key and its own parsing, so
// "accept" in one was invisible to the other two. One format/key/event, defined once,
// means all three agree about what the visitor actually chose.
//
// No Nuxt dependency (matches sanitize-html.ts in this same directory) — this file is
// plain functions operating on a raw `Cookie` header string, so it works identically
// whether called from `document.cookie` on the client or a request's `cookie` header
// on the server.

export const CONSENT_COOKIE_NAME = 'nuxflow_consent'

// Fired on `window` whenever a consent choice is saved, so a script-activation runtime
// (or another consent UI on the same page) can react immediately instead of requiring
// a page reload to notice the cookie changed.
export const CONSENT_EVENT = 'nuxflow:consent-updated'

export interface ConsentState {
  necessary: true
  analytics: boolean
  marketing: boolean
  ts: string
}

// EEA member states plus the UK, Switzerland, Norway, Iceland, and Liechtenstein — the
// same zone GDPR/the ePrivacy directive's prior-consent requirement actually applies
// to. Exported so both CanvasBlockGdpr's client-side geo targeting and the server-side
// script gate read the exact same list instead of two copies that can drift apart.
export const GDPR_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'GB', 'IS', 'LI', 'NO', 'CH',
]

export function isGdprCountry(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false
  return GDPR_COUNTRIES.includes(countryCode.toUpperCase())
}

// Parses the consent cookie out of a raw `Cookie` header string. Never throws — a
// missing, malformed, or foreign cookie value is indistinguishable from "no decision
// yet" to every caller, which is the correct fail-safe default (no consent recorded
// means non-essential scripts stay off, not that they default to on).
export function parseConsentFromHeader(cookieHeader: string | null | undefined): ConsentState | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/(?:^|;\s*)nuxflow_consent=([^;]*)/)
  if (!match) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1] ?? ''))
    if (parsed && typeof parsed === 'object' && typeof parsed.analytics === 'boolean' && typeof parsed.marketing === 'boolean') {
      return {
        necessary: true,
        analytics: parsed.analytics,
        marketing: parsed.marketing,
        ts: typeof parsed.ts === 'string' ? parsed.ts : '',
      }
    }
  }
  catch {
    // Malformed or foreign cookie value — fall through to "no decision yet" below.
  }
  return null
}

export function readConsentCookie(): ConsentState | null {
  if (typeof document === 'undefined') return null
  return parseConsentFromHeader(document.cookie)
}

// Writes the shared cookie, notifies same-page listeners (the other consent UI, and the
// script-activation runtime injected by site-settings-resolver.ts) via CONSENT_EVENT, and
// best-effort logs the choice server-side via POST /api/public/consent (see
// packages/db/src/schema/system.ts's consentLogs table) — a durable record that consent
// was actually captured, independent of the visitor's own cookie, for demonstrating
// compliance (GDPR Article 7(1)) if ever asked. Never awaited and never throws into the
// caller: a visitor's consent choice must take effect in the browser immediately regardless
// of whether this logging call succeeds, reaches a rate limit, or the network is offline.
export function writeConsentCookie(analytics: boolean, marketing: boolean): ConsentState {
  const state: ConsentState = { necessary: true, analytics, marketing, ts: new Date().toISOString() }
  if (typeof document !== 'undefined') {
    document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }))
  }
  if (typeof fetch !== 'undefined') {
    fetch('/api/public/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analytics, marketing }),
      keepalive: true,
    }).catch(() => {})
  }
  return state
}

export function hasOptionalConsent(consent: ConsentState | null): boolean {
  return !!consent && (consent.analytics || consent.marketing)
}
