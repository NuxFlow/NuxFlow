import { describe, it, expect } from 'vitest'
import {
  blockedCrawlerTokens, clampToWords, contentSignal, detectCrawler, effectiveItemRobots, isItemIndexable,
  isNoindexPath, normalizeBaseUrl, parseSeoSettings, publicPathForItem, siteBaseUrl, toIsoDateTime,
} from '../../server/utils/seo'

describe('detectCrawler', () => {
  it('matches the specific OpenAI/Anthropic agents before their training crawler', () => {
    expect(detectCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot')?.token).toBe('ChatGPT-User')
    expect(detectCrawler('Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)')?.token).toBe('OAI-SearchBot')
    expect(detectCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot')?.token).toBe('GPTBot')
    expect(detectCrawler('Mozilla/5.0 (compatible; Claude-SearchBot/1.0)')?.token).toBe('Claude-SearchBot')
    expect(detectCrawler('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')?.token).toBe('ClaudeBot')
  })

  it('classifies classic search engines as search', () => {
    const g = detectCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
    expect(g?.token).toBe('Googlebot')
    expect(g?.category).toBe('search')
    expect(detectCrawler('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')?.token).toBe('Bingbot')
  })

  it('returns null for ordinary browsers and missing UAs', () => {
    expect(detectCrawler('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36')).toBeNull()
    expect(detectCrawler(undefined)).toBeNull()
    expect(detectCrawler('')).toBeNull()
  })
})

describe('blockedCrawlerTokens', () => {
  it('blocks nothing in allow mode', () => {
    expect(blockedCrawlerTokens('allow')).toEqual([])
  })

  it('blocks only training crawlers in block-training mode — AI search and answer bots stay allowed', () => {
    const blocked = blockedCrawlerTokens('block-training')
    expect(blocked).toEqual(expect.arrayContaining(['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent', 'Bytespider']))
    expect(blocked).not.toContain('OAI-SearchBot')
    expect(blocked).not.toContain('ChatGPT-User')
    expect(blocked).not.toContain('PerplexityBot')
    expect(blocked).not.toContain('Claude-SearchBot')
    expect(blocked).not.toContain('Googlebot')
  })

  it('blocks every AI crawler (but never classic search) in disallow mode', () => {
    const blocked = blockedCrawlerTokens('disallow')
    expect(blocked).toEqual(expect.arrayContaining(['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-User']))
    expect(blocked).not.toContain('Googlebot')
    expect(blocked).not.toContain('Bingbot')
  })

  it('uses the real Google-Extended token (not the non-existent Googlebot-Extended)', () => {
    expect(blockedCrawlerTokens('disallow')).toContain('Google-Extended')
    expect(blockedCrawlerTokens('disallow')).not.toContain('Googlebot-Extended')
  })
})

describe('contentSignal', () => {
  it('maps each mode to a Content-Signal value', () => {
    expect(contentSignal({ noindex: false, aiCrawlers: 'allow' })).toBe('search=yes, ai-input=yes, ai-train=yes')
    expect(contentSignal({ noindex: false, aiCrawlers: 'block-training' })).toBe('search=yes, ai-input=yes, ai-train=no')
    expect(contentSignal({ noindex: false, aiCrawlers: 'disallow' })).toBe('search=yes, ai-input=no, ai-train=no')
  })

  it('site-wide noindex overrides the AI mode', () => {
    expect(contentSignal({ noindex: true, aiCrawlers: 'allow' })).toBe('search=no, ai-input=no, ai-train=no')
  })
})

describe('normalizeBaseUrl / siteBaseUrl', () => {
  it('strips trailing slashes and rejects non-http(s) or garbage', () => {
    expect(normalizeBaseUrl('https://example.com/')).toBe('https://example.com')
    expect(normalizeBaseUrl('  https://example.com/blog//  ')).toBe('https://example.com/blog')
    expect(normalizeBaseUrl('ftp://example.com')).toBe('')
    expect(normalizeBaseUrl('example.com')).toBe('')
    expect(normalizeBaseUrl(undefined)).toBe('')
  })

  it('prefers the canonical setting, then the domain, then the fallback', () => {
    expect(siteBaseUrl({ canonicalUrl: 'https://c.test' }, 'd.test')).toBe('https://c.test')
    expect(siteBaseUrl({ canonicalUrl: '' }, 'd.test')).toBe('https://d.test')
    expect(siteBaseUrl({ canonicalUrl: '' }, null, 'https://f.test/')).toBe('https://f.test')
  })
})

describe('parseSeoSettings', () => {
  it('applies defaults for an empty site', () => {
    const s = parseSeoSettings({})
    expect(s.aiCrawlers).toBe('allow')
    expect(s.noindex).toBe(false)
    expect(s.llmsEnabled).toBe(true)
    expect(s.markdownEnabled).toBe(true)
    expect(s.indexnowEnabled).toBe(false)
  })

  it('accepts legacy string booleans and newline lists, and strips @ from the handle', () => {
    const s = parseSeoSettings({
      'seo.llms_enabled': 'false',
      'seo.indexnow_enabled': 'true',
      'seo.social_profiles': 'https://a.test\n\nhttps://b.test',
      'seo.twitter_handle': '@@brand',
      'seo.robots': 'noindex',
      'seo.ai_crawlers': 'block-training',
      'seo.canonical_url': 'https://x.test/',
    })
    expect(s.llmsEnabled).toBe(false)
    expect(s.indexnowEnabled).toBe(true)
    expect(s.socialProfiles).toEqual(['https://a.test', 'https://b.test'])
    expect(s.twitterHandle).toBe('brand')
    expect(s.noindex).toBe(true)
    expect(s.aiCrawlers).toBe('block-training')
    expect(s.canonicalUrl).toBe('https://x.test')
  })

  it('treats an unknown AI mode as allow', () => {
    expect(parseSeoSettings({ 'seo.ai_crawlers': 'nonsense' }).aiCrawlers).toBe('allow')
  })
})

describe('indexability', () => {
  const seo = { noindexContentTypes: ['event'], noindex: false }

  it('isNoindexPath covers account/admin/search screens but not look-alike slugs', () => {
    expect(isNoindexPath('/admin')).toBe(true)
    expect(isNoindexPath('/admin/seo')).toBe(true)
    expect(isNoindexPath('/search?q=x')).toBe(true)
    expect(isNoindexPath('/login')).toBe(true)
    expect(isNoindexPath('/administrators-guide')).toBe(false)
    expect(isNoindexPath('/searching-for-answers')).toBe(false)
    expect(isNoindexPath('/')).toBe(false)
  })

  it('an item\'s own robots value wins over its content type default', () => {
    expect(isItemIndexable({ metaRobots: null, typeSlug: 'event' }, seo)).toBe(false)
    expect(isItemIndexable({ metaRobots: 'index,follow', typeSlug: 'event' }, seo)).toBe(true)
    expect(isItemIndexable({ metaRobots: 'noindex,follow', typeSlug: 'page' }, seo)).toBe(false)
    expect(isItemIndexable({ metaRobots: null, typeSlug: 'page' }, seo)).toBe(true)
  })

  it('effectiveItemRobots applies site-wide noindex first', () => {
    expect(effectiveItemRobots({ metaRobots: 'index,follow' }, { ...seo, noindex: true })).toBe('noindex,nofollow')
    expect(effectiveItemRobots({ metaRobots: null, typeSlug: 'event' }, seo)).toBe('noindex,follow')
    expect(effectiveItemRobots({ metaRobots: null, typeSlug: 'page' }, seo)).toBeNull()
  })
})

describe('publicPathForItem', () => {
  it('maps the homepage to / and translations to /{locale}/{source slug}', () => {
    expect(publicPathForItem({ slug: 'home' }, 'en')).toBe('/')
    expect(publicPathForItem({ slug: 'about' }, 'en')).toBe('/about')
    expect(publicPathForItem({ slug: 'about-es', locale: 'es', sourceSlug: 'about' }, 'en')).toBe('/es/about')
    expect(publicPathForItem({ slug: 'home-es', locale: 'es', sourceSlug: 'home' }, 'en')).toBe('/es')
  })

  it('a translation without a resolvable source stays at its own slug', () => {
    expect(publicPathForItem({ slug: 'about-es', locale: 'es', sourceSlug: null }, 'en')).toBe('/about-es')
  })
})

describe('toIsoDateTime', () => {
  it('converts SQLite datetime() output (UTC) to ISO 8601', () => {
    expect(toIsoDateTime('2026-09-27 12:34:56')).toBe('2026-09-27T12:34:56Z')
  })

  it('normalizes ISO input and rejects junk', () => {
    expect(toIsoDateTime('2026-09-27T12:34:56.000Z')).toBe('2026-09-27T12:34:56.000Z')
    expect(toIsoDateTime('not a date')).toBeUndefined()
    expect(toIsoDateTime(null)).toBeUndefined()
  })
})

describe('clampToWords', () => {
  it('leaves short text alone and strips wrapping quotes', () => {
    expect(clampToWords('"Hello world"', 60)).toBe('Hello world')
  })

  it('trims at a word boundary without a dangling separator', () => {
    const out = clampToWords('The complete guide to edge-deployed content management, for teams', 60)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).toBe('The complete guide to edge-deployed content management, for')
    expect(clampToWords('Alpha beta gamma, delta', 17)).toBe('Alpha beta gamma')
  })

  it('hard-cuts a single overlong word', () => {
    expect(clampToWords('a'.repeat(80), 60)).toHaveLength(60)
  })
})
