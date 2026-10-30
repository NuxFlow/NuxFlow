import { z } from 'zod'
import { isValidLocale, isValidTimeZone } from '../../shared/lib/site-locale'

// Zod rules for a site's default language and timezone, used by every route that saves them.
export const siteLocaleSchema = z.string().trim().refine(isValidLocale, 'Use a language code such as "en" or "pt-BR"')
export const siteTimezoneSchema = z.string().trim().refine(isValidTimeZone, 'Use a timezone such as "Europe/London" or "UTC"')
