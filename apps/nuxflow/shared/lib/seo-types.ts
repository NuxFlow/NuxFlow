// What Admin → SEO gets from the server: AI & crawlers (GET /api/v1/seo/crawlers), the
// audit (buildSeoAudit(), server/utils/seo-audit.ts) and redirects (/api/v1/redirects).
// Import-free.

// ── AI & crawlers

export type CrawlerCategory = 'search' | 'ai-training' | 'ai-search' | 'ai-user'

/** One bot's visits over the period. "Who claims to be crawling": user agents can lie. */
export interface CrawlerActivityRow {
  bot: string
  category: string
  hits: number
  lastSeenAt: string
  lastPath: string | null
}

export interface CrawlerReport {
  days: number
  /** First day counted (UTC, YYYY-MM-DD). */
  since: string
  daily: { day: string; category: string; hits: number }[]
  /** Blocked by the site's AI crawler setting. */
  bots: (CrawlerActivityRow & { blocked: boolean })[]
  /** Every crawler NuxFlow knows about, and whether it's blocked. */
  registry: { token: string; owner: string; category: CrawlerCategory; legacy: boolean; blocked: boolean }[]
}

// ── Audit

export type AuditIssueCode =
  | 'missing_description' | 'description_too_short' | 'description_too_long' | 'no_custom_description'
  | 'title_too_long' | 'duplicate_title' | 'duplicate_description'
  | 'missing_image' | 'inline_image' | 'noindex' | 'external_canonical'

export interface AuditIssue { code: AuditIssueCode; severity: 'error' | 'warning' | 'info'; message: string }

/** A site-wide check (default description, share image, verification…). */
export interface SiteCheck { id: string; severity: 'error' | 'warning' | 'info' | 'ok'; message: string }

/** A page with at least one issue. */
export interface AuditItem {
  id: string
  title: string
  path: string
  typeName: string | null
  issues: AuditIssue[]
}

export interface SeoAuditResponse {
  /** `truncated`: only the most recent pages were checked. */
  summary: { total: number; indexed: number; withIssues: number; counts: Partial<Record<AuditIssueCode, number>>; truncated: boolean }
  site: SiteCheck[]
  items: AuditItem[]
}

// ── Redirects

export type RedirectStatusCode = 301 | 302 | 307 | 308 | 410

export interface AdminRedirect {
  id: string
  from: string
  /** Empty for 410 Gone. */
  to: string
  statusCode: number
  createdAt: string
}

/** POST /api/v1/redirects/import: a CSV of rules. */
export interface RedirectImportResult {
  created: number
  updated: number
  skipped: number
  errors: { line: number; message: string }[]
}
