import { describe, expect, it } from 'vitest'
import { SITE_LANGUAGES, browserTimeZone, isValidLocale, isValidTimeZone, timeZoneOptions } from '../../shared/lib/site-locale'
import { SUPPORTED_LOCALES } from '../../server/utils/public-page'

describe('site language and timezone', () => {
  it('accepts language codes and refuses free text', () => {
    expect(isValidLocale('en')).toBe(true)
    expect(isValidLocale('pt-BR')).toBe(true)
    expect(isValidLocale('English')).toBe(false)
    expect(isValidLocale('en us')).toBe(false)
    expect(isValidLocale('')).toBe(false)
  })

  it('offers exactly the languages the public routes recognise', () => {
    expect(new Set(SITE_LANGUAGES.map(l => l.value))).toEqual(SUPPORTED_LOCALES)
  })

  it('accepts IANA timezones and refuses anything else', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('GMT+1 London')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('lists UTC first, once, and only valid zones', () => {
    const zones = timeZoneOptions()
    expect(zones[0]).toBe('UTC')
    expect(zones.filter(z => z === 'UTC')).toHaveLength(1)
    expect(zones).toContain('Europe/London')
    expect(zones.every(isValidTimeZone)).toBe(true)
    expect(isValidTimeZone(browserTimeZone())).toBe(true)
  })
})
