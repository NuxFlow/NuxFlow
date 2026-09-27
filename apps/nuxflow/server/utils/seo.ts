import { siteSettings } from '@nuxflow/db/schema'
import { and, eq, like } from 'drizzle-orm'
import type { Db } from './db'
import { createIsolateCache } from './isolate-cache'

/**
 * Shared SEO/GEO settings and helpers — the single place robots.txt, the sitemaps,
 * llms.txt, the Markdown alternate, the response-header middleware (05.seo-headers.ts)
 * and GET /api/public/site all read the site's `seo.*` settings from, so none of them
 * can disagree about (for example) whether the site is noindexed or what its canonical
 * base URL is.
 */

// ── Crawler registry ─────────────────────────────────────────────────────────

export type CrawlerCategory = 'search' | 'ai-training' | 'ai-search' | 'ai-user'

export interface KnownCrawler {
  /** Display name and robots.txt `User-agent` token. */
  token: string
  owner: string
  category: CrawlerCategory
  /** Lower-case substring matched against the request's User-Agent header. Absent for
   * robots.txt-only control tokens (Google-Extended, Applebot-Extended) that never
   * appear in a real User-Agent — their crawling is done by Googlebot/Applebot. */
  ua?: string
  /** Superseded token kept only so robots.txt still covers older crawler versions. */
  legacy?: boolean
}

/**
 * Categories:
 * - `ai-training`: collects content to train/fine-tune models.
 * - `ai-search`: builds an index an AI assistant cites answers from (the GEO-relevant ones).
 * - `ai-user`: fetches a page live because a user asked an assistant about it.
 * - `search`: classic search engines (never blocked by the AI setting — only by noindex).
 *
 * Order matters for User-Agent matching: more specific tokens first (e.g. "ChatGPT-User"
 * and "OAI-SearchBot" before "GPTBot"; "Claude-User"/"Claude-SearchBot" before "ClaudeBot").
 */
export const KNOWN_CRAWLERS: readonly KnownCrawler[] = [
  // OpenAI
  { token: 'OAI-SearchBot', owner: 'OpenAI', category: 'ai-search', ua: 'oai-searchbot' },
  { token: 'ChatGPT-User', owner: 'OpenAI', category: 'ai-user', ua: 'chatgpt-user' },
  { token: 'GPTBot', owner: 'OpenAI', category: 'ai-training', ua: 'gptbot' },
  // Anthropic
  { token: 'Claude-SearchBot', owner: 'Anthropic', category: 'ai-search', ua: 'claude-searchbot' },
  { token: 'Claude-User', owner: 'Anthropic', category: 'ai-user', ua: 'claude-user' },
  { token: 'ClaudeBot', owner: 'Anthropic', category: 'ai-training', ua: 'claudebot' },
  { token: 'anthropic-ai', owner: 'Anthropic', category: 'ai-training', ua: 'anthropic-ai', legacy: true },
  // Perplexity
  { token: 'Perplexity-User', owner: 'Perplexity', category: 'ai-user', ua: 'perplexity-user' },
  { token: 'PerplexityBot', owner: 'Perplexity', category: 'ai-search', ua: 'perplexitybot' },
  // Google / Apple control tokens (robots.txt only)
  { token: 'Google-Extended', owner: 'Google', category: 'ai-training' },
  { token: 'Applebot-Extended', owner: 'Apple', category: 'ai-training' },
  // Meta
  { token: 'meta-externalfetcher', owner: 'Meta', category: 'ai-user', ua: 'meta-externalfetcher' },
  { token: 'meta-externalagent', owner: 'Meta', category: 'ai-training', ua: 'meta-externalagent' },
  { token: 'FacebookBot', owner: 'Meta', category: 'ai-training', ua: 'facebookbot' },
  // Others
  { token: 'DuckAssistBot', owner: 'DuckDuckGo', category: 'ai-user', ua: 'duckassistbot' },
  { token: 'MistralAI-User', owner: 'Mistral', category: 'ai-user', ua: 'mistralai-user' },
  { token: 'Bytespider', owner: 'ByteDance', category: 'ai-training', ua: 'bytespider' },
  { token: 'Amazonbot', owner: 'Amazon', category: 'ai-training', ua: 'amazonbot' },
  { token: 'CCBot', owner: 'Common Crawl', category: 'ai-training', ua: 'ccbot' },
  { token: 'cohere-training-data-crawler', owner: 'Cohere', category: 'ai-training', ua: 'cohere-training-data-crawler' },
  { token: 'cohere-ai', owner: 'Cohere', category: 'ai-training', ua: 'cohere-ai', legacy: true },
  { token: 'Diffbot', owner: 'Diffbot', category: 'ai-training', ua: 'diffbot' },
  { token: 'Timpibot', owner: 'Timpi', category: 'ai-training', ua: 'timpibot' },
  // Classic search engines — tracked for the crawler-activity view, never blocked here.
  { token: 'Googlebot', owner: 'Google', category: 'search', ua: 'googlebot' },
  { token: 'Bingbot', owner: 'Microsoft', category: 'search', ua: 'bingbot' },
  { token: 'Applebot', owner: 'Apple', category: 'search', ua: 'applebot' },
  { token: 'DuckDuckBot', owner: 'DuckDuckGo', category: 'search', ua: 'duckduckbot' },
  { token: 'YandexBot', owner: 'Yandex', category: 'search', ua: 'yandexbot' },
  { token: 'Baiduspider', owner: 'Baidu', category: 'search', ua: 'baiduspider' },
]

/** Matches a User-Agent header against KNOWN_CRAWLERS (first match wins). */
export function detectCrawler(userAgent: string | undefined | null): KnownCrawler | null {
  if (!userAgent) return null
  const ua = userAgent.toLowerCase()
  for (const c of KNOWN_CRAWLERS) {
    if (c.ua && ua.includes(c.ua)) return c
  }
  return null
}

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * - `allow`: every AI crawler may crawl.
 * - `block-training`: model-training crawlers are blocked; AI search/answer crawlers stay
 *   allowed so the site can still be cited in AI answers (the usual GEO choice).
 * - `disallow`: every AI crawler is blocked (stored value kept from before
 *   `block-training` existed, so existing sites keep their meaning).
 */
export type AiCrawlerMode = 'allow' | 'block-training' | 'disallow'

export interface SeoSettings {
  title: string
  description: string
  /** Normalized (no trailing slash), or '' when unset/invalid. */
  canonicalUrl: string
  ogImage: string
  noindex: boolean
  aiCrawlers: AiCrawlerMode
  robotsCustom: string
  twitterHandle: string
  socialProfiles: string[]
  verification: { google: string; bing: string; yandex: string; pinterest: string }
  noindexTaxonomies: boolean
  noindexContentTypes: string[]
  llmsEnabled: boolean
  llmsIntro: string
  markdownEnabled: boolean
  indexnowEnabled: boolean
  indexnowKey: string
  redirectToPrimary: boolean
}

export const SEO_DEFAULTS: SeoSettings = {
  title: '',
  description: '',
  canonicalUrl: '',
  ogImage: '',
  noindex: false,
  aiCrawlers: 'allow',
  robotsCustom: '',
  twitterHandle: '',
  socialProfiles: [],
  verification: { google: '', bing: '', yandex: '', pinterest: '' },
  noindexTaxonomies: false,
  noindexContentTypes: [],
  llmsEnabled: true,
  llmsIntro: '',
  markdownEnabled: true,
  indexnowEnabled: false,
  indexnowKey: '',
  redirectToPrimary: false,
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// Settings saved through different UIs over time have been stored both as real JSON
// booleans and as the strings 'true'/'false' — accept either.
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

function strList(v: unknown): string[] {
  const arr = Array.isArray(v)
    ? v
    : typeof v === 'string' ? v.split(/\r?\n/) : []
  return arr.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
}

/**
 * Normalizes a canonical base URL: must be absolute http(s), trailing slashes removed
 * (a trailing slash used to produce `https://x.com//slug` canonicals). Returns '' for
 * anything unusable so callers fall back to the site's own domain.
 */
export function normalizeBaseUrl(raw: unknown): string {
  const s = str(raw)
  if (!s) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function parseSeoSettings(kv: Record<string, unknown>): SeoSettings {
  const ai = str(kv['seo.ai_crawlers'])
  return {
    title: str(kv['seo.title']),
    description: str(kv['seo.description']),
    canonicalUrl: normalizeBaseUrl(kv['seo.canonical_url']),
    ogImage: str(kv['seo.og_image']),
    noindex: str(kv['seo.robots']) === 'noindex',
    aiCrawlers: ai === 'disallow' || ai === 'block-training' ? ai : 'allow',
    robotsCustom: typeof kv['seo.robots_custom'] === 'string' ? (kv['seo.robots_custom'] as string).trim() : '',
    twitterHandle: str(kv['seo.twitter_handle']).replace(/^@+/, ''),
    socialProfiles: strList(kv['seo.social_profiles']),
    verification: {
      google: str(kv['seo.verify_google']),
      bing: str(kv['seo.verify_bing']),
      yandex: str(kv['seo.verify_yandex']),
      pinterest: str(kv['seo.verify_pinterest']),
    },
    noindexTaxonomies: bool(kv['seo.noindex_taxonomies'], false),
    noindexContentTypes: strList(kv['seo.noindex_content_types']),
    llmsEnabled: bool(kv['seo.llms_enabled'], true),
    llmsIntro: typeof kv['seo.llms_intro'] === 'string' ? (kv['seo.llms_intro'] as string).trim() : '',
    markdownEnabled: bool(kv['seo.markdown_enabled'], true),
    indexnowEnabled: bool(kv['seo.indexnow_enabled'], false),
    indexnowKey: str(kv['seo.indexnow_key']),
    redirectToPrimary: bool(kv['seo.redirect_to_primary'], false),
  }
}

// Read on every public request by 05.seo-headers.ts, so it gets the same short per-isolate
// cache the settings layer uses (settings.ts). Cleared on save in the current isolate;
// other isolates pick a change up within the TTL.
const _seoCache = createIsolateCache<SeoSettings>(30_000)

export function clearSeoSettingsCache(siteId?: string): void {
  if (siteId) _seoCache.delete(siteId)
  else _seoCache.clear()
}

/** Loads every `seo.*` setting for a site in one query. */
export async function getSeoSettings(db: Db, siteId: string): Promise<SeoSettings> {
  const cached = _seoCache.get(siteId)
  if (cached) return cached

  const rows = await db.query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId), like(siteSettings.key, 'seo.%')),
    columns: { key: true, value: true },
  })
  const settings = parseSeoSettings(Object.fromEntries(rows.map(r => [r.key, r.value])))
  _seoCache.set(siteId, settings)
  return settings
}

/** The base URL every absolute link on a site is built from. */
export function siteBaseUrl(seo: Pick<SeoSettings, 'canonicalUrl'>, domain: string | null | undefined, fallback = ''): string {
  if (seo.canonicalUrl) return seo.canonicalUrl
  if (domain) return `https://${domain}`
  return fallback.replace(/\/+$/, '')
}

// ── Content signals ──────────────────────────────────────────────────────────

/**
 * The Content Signals policy (https://contentsignals.org) line for a site's settings —
 * emitted in robots.txt and as a `Content-Signal` response header. The header matters on
 * Cloudflare specifically: Markdown for Agents stamps `ai-train=yes, search=yes,
 * ai-input=yes` on every converted response *unless the origin sends its own*, which
 * would otherwise contradict a site that chose to block AI training.
 */
export function contentSignal(seo: Pick<SeoSettings, 'noindex' | 'aiCrawlers'>): string {
  if (seo.noindex) return 'search=no, ai-input=no, ai-train=no'
  switch (seo.aiCrawlers) {
    case 'disallow': return 'search=yes, ai-input=no, ai-train=no'
    case 'block-training': return 'search=yes, ai-input=yes, ai-train=no'
    default: return 'search=yes, ai-input=yes, ai-train=yes'
  }
}

/** robots.txt tokens the current AI mode blocks. */
export function blockedCrawlerTokens(mode: AiCrawlerMode): string[] {
  if (mode === 'allow') return []
  const categories: CrawlerCategory[] = mode === 'block-training'
    ? ['ai-training']
    : ['ai-training', 'ai-search', 'ai-user']
  return KNOWN_CRAWLERS.filter(c => categories.includes(c.category)).map(c => c.token)
}

// ── Indexability ─────────────────────────────────────────────────────────────

/**
 * Paths that are never meant to be in a search index — account/auth screens, the admin,
 * setup, and internal search results (Google's guidance is to keep those out). Sent a
 * `X-Robots-Tag: noindex` header by 05.seo-headers.ts and disallowed in robots.txt.
 */
export const NOINDEX_PATHS = ['/admin', '/login', '/register', '/forgot-password', '/reset-password', '/account', '/setup', '/search'] as const

export function isNoindexPath(path: string): boolean {
  const p = path.split('?')[0] || '/'
  return NOINDEX_PATHS.some(prefix => p === prefix || p.startsWith(`${prefix}/`))
}

export function robotsSaysNoindex(metaRobots: string | null | undefined): boolean {
  return Boolean(metaRobots && /\bnoindex\b/i.test(metaRobots))
}

/**
 * Whether a published, public item should be indexed: an explicit per-item robots value
 * wins; otherwise the site's per-content-type default applies.
 */
export function isItemIndexable(
  item: { metaRobots?: string | null; typeSlug?: string | null },
  seo: Pick<SeoSettings, 'noindexContentTypes'>,
): boolean {
  if (item.metaRobots) return !robotsSaysNoindex(item.metaRobots)
  return !(item.typeSlug && seo.noindexContentTypes.includes(item.typeSlug))
}

/** The effective robots meta value for an item (null = default index,follow). */
export function effectiveItemRobots(
  item: { metaRobots?: string | null; typeSlug?: string | null },
  seo: Pick<SeoSettings, 'noindexContentTypes' | 'noindex'>,
): string | null {
  if (seo.noindex) return 'noindex,nofollow'
  if (item.metaRobots) return item.metaRobots
  if (item.typeSlug && seo.noindexContentTypes.includes(item.typeSlug)) return 'noindex,follow'
  return null
}

// ── URLs and dates ───────────────────────────────────────────────────────────

/**
 * The public path an item is served at. The homepage item (slug `home`) lives at `/`;
 * a translation lives at `/{locale}/{source slug}` (see api/public/pages/[...slug].get.ts's
 * locale-prefix resolution), not at its own stored slug (`about-es`), which also resolves
 * but is only an internal identifier.
 */
export function publicPathForItem(
  item: { slug: string; locale?: string | null; sourceSlug?: string | null },
  defaultLocale: string,
): string {
  if (item.sourceSlug && item.locale && item.locale !== defaultLocale) {
    return item.sourceSlug === 'home' ? `/${item.locale}` : `/${item.locale}/${item.sourceSlug}`
  }
  return item.slug === 'home' ? '/' : `/${item.slug}`
}

const SQLITE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/

/**
 * Converts a stored timestamp to ISO 8601. Rows written with SQLite's `datetime('now')`
 * are `YYYY-MM-DD HH:MM:SS` in UTC — not a valid W3C datetime for a sitemap `<lastmod>`
 * or schema.org `dateModified`.
 */
export function toIsoDateTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const m = SQLITE_DATETIME.exec(value)
  if (m) return `${m[1]}T${m[2]}Z`
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Trims to `max` characters at a word boundary, without a dangling separator. */
export function clampToWords(text: string, max: number): string {
  const t = text.trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max)).replace(/[\s,;:—–-]+$/, '')
}
