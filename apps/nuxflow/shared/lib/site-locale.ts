// A site's default language (`sites.locale`) and timezone, shared by every form that sets
// them (Super Admin → Sites, the setup wizard, Settings → General) and by the routes that
// save them. The language code is URL-significant — translations live at `/{locale}/…`
// — so it must be a real code, never free text like "English".

/** Languages offered in the pickers: the codes the public routes recognise without a lookup (SUPPORTED_LOCALES). */
export const SITE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ru', label: 'Russian' },
  { value: 'hi', label: 'Hindi' },
]

/** BCP 47-shaped language code ("en", "pt-BR") — the same rule the translate route uses. */
export const LOCALE_CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export function isValidLocale(value: string): boolean {
  return LOCALE_CODE_RE.test(value)
}

/** Whether the runtime knows `value` as an IANA timezone ("Europe/London", "UTC"). */
export function isValidTimeZone(value: string): boolean {
  if (!value) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Every IANA timezone the runtime knows, UTC first. */
export function timeZoneOptions(): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return ['UTC', ...zones.filter(z => z !== 'UTC')]
}

/** The browser's own timezone, when it's a valid one — a better default than UTC for a new site. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && isValidTimeZone(zone) ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}
