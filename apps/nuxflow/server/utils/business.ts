import type { H3Event } from 'h3'
import { z } from 'zod'
import { parseBusinessInfo, type BusinessInfo } from '@nuxflow/canvas/business'
import { resolveSetting } from './settings'
import { validationError } from './response'

/**
 * The site's business details and opening hours (Settings → Business), one JSON setting.
 * Read by the public site payload (the Opening Hours block, and the layout's LocalBusiness
 * data on every page). Saved through PATCH /api/v1/settings like any setting — that route
 * already clears the whole site's page cache — after normalizeBusinessSetting() checks it.
 * (Not its own route: one more route address tips `nuxt typecheck` into TS2589.)
 */
export const BUSINESS_SETTING_KEY = 'business.profile'

export async function getBusinessInfo(event: H3Event): Promise<BusinessInfo | null> {
  return parseBusinessInfo(await resolveSetting(event, BUSINESS_SETTING_KEY))
}

/** True when there's anything worth publishing (an address, a phone, or some hours). */
export function hasBusinessDetails(info: BusinessInfo | null): info is BusinessInfo {
  if (!info) return false
  return Boolean(info.phone || info.street || info.locality || info.postcode
    || Object.values(info.hours).some(s => s.length) || info.exceptions.length)
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/
const slot = z.object({ open: z.string().regex(TIME, 'Times look like 09:00'), close: z.string().regex(TIME, 'Times look like 17:30') })
  .refine(s => s.open !== '24:00', 'Hours can\'t open at 24:00')
  .refine(s => s.open !== s.close, 'Hours can\'t open and close at the same time')

const businessSchema = z.object({
  kind: z.string().max(60),
  name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.union([z.literal(''), z.string().email('That email address doesn\'t look right').max(200)]).optional(),
  street: z.string().max(200).optional(),
  locality: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  country: z.union([z.literal(''), z.string().regex(/^[a-z]{2}$/i, 'Use the two-letter country code, e.g. GB')]).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  priceRange: z.string().max(20).optional(),
  hoursNote: z.string().max(200).optional(),
  hours: z.record(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), z.array(slot).max(4)),
  exceptions: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates look like 2026-12-25'),
    slots: z.array(slot).max(4),
    note: z.string().max(120).optional(),
  })).max(100)
    .refine(list => new Set(list.map(e => e.date)).size === list.length, 'Each date can only be listed once'),
})

/**
 * Checks a `business.profile` value sent to the settings PATCH and returns what to store:
 * the normalised profile, or null when nothing is left to publish. Throws a 422 with the
 * first problem in plain words.
 */
export function normalizeBusinessSetting(value: unknown): BusinessInfo | null {
  if (value === null) return null
  const result = businessSchema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw validationError(issue ? `Business details: ${issue.message}` : 'Business details aren\'t valid')
  }
  const info = parseBusinessInfo(result.data)
  return hasBusinessDetails(info) ? info : null
}
