import type { SeoSettings } from './seo'

export interface AuditItemInput {
  id: string
  title: string
  path: string
  typeName: string | null
  isPublic: boolean
  seoTitle: string | null
  description: string | null
  hasOwnDescription: boolean
  ogImage: string | null
  noindex: boolean
  canonicalUrl: string | null
}

export type AuditIssueCode =
  | 'missing_description' | 'description_too_short' | 'description_too_long' | 'no_custom_description'
  | 'title_too_long' | 'duplicate_title' | 'duplicate_description'
  | 'missing_image' | 'inline_image' | 'noindex' | 'external_canonical'

export interface AuditIssue { code: AuditIssueCode; severity: 'error' | 'warning' | 'info'; message: string }

export interface SiteCheck { id: string; severity: 'error' | 'warning' | 'info' | 'ok'; message: string }

const TITLE_MAX = 60
const DESC_MIN = 50
const DESC_MAX = 160

/** Pure scoring logic for GET /api/v1/seo/audit — separated so it's unit-testable. */
export function buildSeoAudit(items: AuditItemInput[], seo: SeoSettings, opts: { truncated: boolean }) {
  // Duplicates only matter among pages a search engine will actually index.
  const indexed = items.filter(i => i.isPublic && !i.noindex)
  const count = (values: (string | null)[]) => {
    const m = new Map<string, number>()
    for (const v of values) {
      if (!v) continue
      const key = v.trim().toLowerCase()
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }
  const titleCounts = count(indexed.map(i => i.seoTitle || i.title))
  const descCounts = count(indexed.map(i => i.description))

  const results = items.map((i) => {
    const issues: AuditIssue[] = []
    const effectiveTitle = (i.seoTitle || i.title).trim()
    const desc = i.description?.trim() ?? ''

    // Members-only/private pages aren't crawlable, so SEO checks don't apply to them.
    if (!i.isPublic) return { ...i, issues }
    if (i.noindex) {
      issues.push({ code: 'noindex', severity: 'info', message: 'Hidden from search engines (noindex)' })
      return { ...i, issues }
    }
    if (!desc) issues.push({ code: 'missing_description', severity: 'error', message: 'No meta description or excerpt — search engines will pick arbitrary text' })
    else if (desc.length < DESC_MIN) issues.push({ code: 'description_too_short', severity: 'warning', message: `Description is short (${desc.length} chars; aim for ${DESC_MIN}–${DESC_MAX})` })
    else if (desc.length > DESC_MAX) issues.push({ code: 'description_too_long', severity: 'warning', message: `Description will be truncated (${desc.length} chars; max ${DESC_MAX})` })
    if (desc && !i.hasOwnDescription) issues.push({ code: 'no_custom_description', severity: 'info', message: 'Using the excerpt as the meta description' })
    if (effectiveTitle.length > TITLE_MAX) issues.push({ code: 'title_too_long', severity: 'warning', message: `Title will be truncated (${effectiveTitle.length} chars; max ${TITLE_MAX})` })
    if ((titleCounts.get(effectiveTitle.toLowerCase()) ?? 0) > 1) issues.push({ code: 'duplicate_title', severity: 'warning', message: 'Another indexed page has the same title' })
    if (desc && (descCounts.get(desc.toLowerCase()) ?? 0) > 1) issues.push({ code: 'duplicate_description', severity: 'warning', message: 'Another indexed page has the same description' })
    if (i.ogImage?.startsWith('data:')) {
      issues.push({ code: 'inline_image', severity: 'warning', message: 'Featured image is stored inside the database — social networks can\'t fetch it. Move media to real storage (Settings → Media).' })
    } else if (!i.ogImage && !seo.ogImage) {
      issues.push({ code: 'missing_image', severity: 'warning', message: 'No featured/share image, and no site default' })
    }
    if (i.canonicalUrl) issues.push({ code: 'external_canonical', severity: 'info', message: `Canonical points to ${i.canonicalUrl}` })
    return { ...i, issues }
  })

  const site: SiteCheck[] = []
  if (seo.noindex) site.push({ id: 'noindex', severity: 'error', message: 'The whole site is hidden from search engines (Global defaults → Search engine indexing).' })
  site.push(seo.description
    ? { id: 'description', severity: 'ok', message: 'Default meta description is set.' }
    : { id: 'description', severity: 'warning', message: 'No default meta description — the homepage and archive pages have no description.' })
  site.push(seo.ogImage
    ? { id: 'og_image', severity: 'ok', message: 'Default share image is set.' }
    : { id: 'og_image', severity: 'warning', message: 'No default share image — pages without a featured image share with no picture.' })
  site.push(seo.verification.google || seo.verification.bing
    ? { id: 'verification', severity: 'ok', message: 'Search engine verification is configured.' }
    : { id: 'verification', severity: 'info', message: 'No Google/Bing verification code — add one under Social & verification, unless the domain is verified by DNS.' })
  if (seo.aiCrawlers === 'disallow') site.push({ id: 'ai', severity: 'info', message: 'All AI crawlers are blocked — the site won\'t be cited by AI assistants.' })
  site.push(seo.indexnowEnabled
    ? { id: 'indexnow', severity: 'ok', message: 'IndexNow is on — Bing and others are notified of changes instantly.' }
    : { id: 'indexnow', severity: 'info', message: 'IndexNow is off (Indexing tab) — Bing, Yandex and others only see changes on their next crawl.' })

  const withIssues = results.filter(r => r.issues.some(x => x.severity !== 'info'))
  const counts: Partial<Record<AuditIssueCode, number>> = {}
  for (const r of results) {
    for (const x of r.issues) counts[x.code] = (counts[x.code] ?? 0) + 1
  }

  return {
    summary: { total: results.length, indexed: indexed.length, withIssues: withIssues.length, counts, truncated: opts.truncated },
    site,
    items: results.filter(r => r.issues.length > 0),
  }
}
