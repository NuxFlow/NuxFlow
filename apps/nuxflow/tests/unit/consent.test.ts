/**
 * Unit tests for @nuxflow/canvas's shared consent utility
 * (packages/canvas/src/utils/consent.ts) — the single format both consent UIs
 * (CookieConsent.vue and CanvasBlockGdpr.vue) read/write, and that
 * server/plugins/site-settings-resolver.ts parses to decide whether to inject
 * admin-configured head/body code directly or hold it back until consent is granted.
 *
 * Covers parseConsentFromHeader/hasOptionalConsent/isGdprCountry only — these run in
 * plain Node (this suite's environment) with no DOM. readConsentCookie/writeConsentCookie
 * are thin document.cookie/window wrappers around the same parsing logic and are
 * exercised indirectly through the two consent components' own behaviour.
 */
import { describe, it, expect } from 'vitest'
import { GDPR_COUNTRIES, hasOptionalConsent, isGdprCountry, parseConsentFromHeader } from '../../../../packages/canvas/src/utils/consent'

describe('parseConsentFromHeader', () => {
  it('returns null when the header is missing entirely', () => {
    expect(parseConsentFromHeader(undefined)).toBeNull()
    expect(parseConsentFromHeader(null)).toBeNull()
    expect(parseConsentFromHeader('')).toBeNull()
  })

  it('returns null when the cookie is absent from a header with other cookies', () => {
    expect(parseConsentFromHeader('other=1; another=2')).toBeNull()
  })

  it('parses a granted-all consent cookie among other cookies', () => {
    const state = { necessary: true, analytics: true, marketing: true, ts: '2026-01-01T00:00:00.000Z' }
    const header = `foo=bar; nuxflow_consent=${encodeURIComponent(JSON.stringify(state))}; baz=qux`
    expect(parseConsentFromHeader(header)).toEqual(state)
  })

  it('parses a necessary-only (declined) consent cookie', () => {
    const state = { necessary: true, analytics: false, marketing: false, ts: '2026-01-01T00:00:00.000Z' }
    const header = `nuxflow_consent=${encodeURIComponent(JSON.stringify(state))}`
    expect(parseConsentFromHeader(header)).toEqual(state)
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseConsentFromHeader('nuxflow_consent=not-json')).toBeNull()
  })

  it('returns null when analytics/marketing are missing or not booleans', () => {
    expect(parseConsentFromHeader(`nuxflow_consent=${encodeURIComponent(JSON.stringify({ necessary: true }))}`)).toBeNull()
    expect(parseConsentFromHeader(`nuxflow_consent=${encodeURIComponent(JSON.stringify({ analytics: 'yes', marketing: 'no' }))}`)).toBeNull()
  })

  it('defaults a missing/non-string ts to an empty string rather than failing', () => {
    const header = `nuxflow_consent=${encodeURIComponent(JSON.stringify({ analytics: true, marketing: false }))}`
    expect(parseConsentFromHeader(header)?.ts).toBe('')
  })
})

describe('hasOptionalConsent', () => {
  it('is false for null (no decision recorded yet)', () => {
    expect(hasOptionalConsent(null)).toBe(false)
  })

  it('is false when both analytics and marketing are declined', () => {
    expect(hasOptionalConsent({ necessary: true, analytics: false, marketing: false, ts: '' })).toBe(false)
  })

  it('is true when either analytics or marketing is granted', () => {
    expect(hasOptionalConsent({ necessary: true, analytics: true, marketing: false, ts: '' })).toBe(true)
    expect(hasOptionalConsent({ necessary: true, analytics: false, marketing: true, ts: '' })).toBe(true)
  })
})

describe('isGdprCountry', () => {
  it('is false for a missing or empty country code', () => {
    expect(isGdprCountry(undefined)).toBe(false)
    expect(isGdprCountry(null)).toBe(false)
    expect(isGdprCountry('')).toBe(false)
  })

  it('is true for every code in the shared GDPR_COUNTRIES list', () => {
    for (const code of GDPR_COUNTRIES) {
      expect(isGdprCountry(code)).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(isGdprCountry('de')).toBe(true)
    expect(isGdprCountry('De')).toBe(true)
  })

  it('is false for a country outside the zone', () => {
    expect(isGdprCountry('US')).toBe(false)
    expect(isGdprCountry('JP')).toBe(false)
  })
})
