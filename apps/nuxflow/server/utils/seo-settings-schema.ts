import { z } from 'zod'
import { normalizeBaseUrl } from './seo'
import { validationError } from './response'

const httpUrl = z.string().trim().max(2048).refine((v) => {
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}, 'Must be a full http(s) URL')

// People often paste the whole verification <meta> tag instead of just the code —
// accept that and keep only the content="…" value.
const verificationCode = z.string().trim().max(500).transform((v) => {
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(v)
  return (m ? m[1]! : v).trim()
}).refine(v => v.length <= 200 && !/[<>"\s]/.test(v), 'Paste the verification code (or the whole meta tag)')

const ROBOTS_DIRECTIVES = new Set(['user-agent', 'allow', 'disallow', 'crawl-delay', 'sitemap', 'content-signal', 'host', 'clean-param'])

const robotsRules = z.string().max(5000).refine((text) => text.split(/\r?\n/).every((raw) => {
  const line = raw.trim()
  if (!line || line.startsWith('#')) return true
  const colon = line.indexOf(':')
  return colon > 0 && ROBOTS_DIRECTIVES.has(line.slice(0, colon).trim().toLowerCase())
}), 'Each line must be a comment or a robots.txt directive (User-agent, Allow, Disallow, Crawl-delay, Sitemap, Content-Signal)')

/**
 * Every `seo.*` key PATCH /api/v1/settings accepts, with its validation/normalization.
 * The settings route otherwise takes a free-form key map; for SEO keys, a typo'd value
 * (a canonical URL with a trailing slash, a pasted meta tag) silently broke public output
 * before, so these are checked and normalized at save time instead.
 */
export const SEO_SETTING_SCHEMAS: Record<string, z.ZodType> = {
  'seo.title': z.string().trim().max(120),
  'seo.description': z.string().trim().max(500),
  'seo.canonical_url': z.union([z.literal(''), httpUrl]).transform(v => normalizeBaseUrl(v)),
  'seo.og_image': z.union([z.literal(''), httpUrl, z.string().trim().startsWith('/').max(2048)]),
  'seo.robots': z.enum(['index', 'noindex']),
  'seo.ai_crawlers': z.enum(['allow', 'block-training', 'disallow']),
  'seo.robots_custom': robotsRules,
  'seo.twitter_handle': z.string().trim().transform(v => v.replace(/^@+/, '')).refine(v => v === '' || /^\w{1,15}$/.test(v), 'Enter a valid X/Twitter handle'),
  'seo.social_profiles': z.array(httpUrl).max(20),
  'seo.verify_google': verificationCode,
  'seo.verify_bing': verificationCode,
  'seo.verify_yandex': verificationCode,
  'seo.verify_pinterest': verificationCode,
  'seo.noindex_taxonomies': z.boolean(),
  'seo.noindex_content_types': z.array(z.string().trim().min(1).max(100)).max(50),
  'seo.llms_enabled': z.boolean(),
  'seo.llms_intro': z.string().max(5000),
  'seo.markdown_enabled': z.boolean(),
  'seo.indexnow_enabled': z.boolean(),
  'seo.indexnow_key': z.string().regex(/^[a-z0-9-]{8,128}$/i, 'IndexNow keys are 8–128 letters, digits, or dashes'),
  'seo.redirect_to_primary': z.boolean(),
}

/** Validates and normalizes the `seo.*` entries of a settings patch. Throws a 422 naming the first bad key. */
export function normalizeSeoSettings(entries: [string, unknown][]): [string, unknown][] {
  return entries.map(([key, value]) => {
    if (!key.startsWith('seo.')) return [key, value]
    const schema = SEO_SETTING_SCHEMAS[key]
    if (!schema) validationError(`Unknown SEO setting "${key}"`)
    const parsed = schema.safeParse(value)
    if (!parsed.success) validationError(`${key}: ${parsed.error.issues[0]?.message ?? 'invalid value'}`)
    return [key, parsed.data]
  })
}
