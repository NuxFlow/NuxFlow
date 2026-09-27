import { describe, it, expect, beforeAll } from 'vitest'
import { normalizeRedirectPath, redirectTarget } from '../../server/utils/redirect-cache'
import { parseRedirectCsv, redirectRuleSchema } from '../../server/utils/redirects'

// server/utils/response.ts (used by seo-settings-schema.ts's validationError) calls the
// h3 createError auto-import.
beforeAll(() => {
  ;(globalThis as Record<string, unknown>).createError = (opts: { statusCode?: number; message?: string }) =>
    Object.assign(new Error(opts.message), { statusCode: opts.statusCode })
})

const { normalizeSeoSettings } = await import('../../server/utils/seo-settings-schema')

describe('normalizeRedirectPath', () => {
  it('drops query/fragment and trailing slash, and lower-cases', () => {
    expect(normalizeRedirectPath('/Old-Page/?utm_source=x#top')).toBe('/old-page')
    expect(normalizeRedirectPath('/')).toBe('/')
    expect(normalizeRedirectPath('old')).toBe('/old')
    expect(normalizeRedirectPath('//double//slashes/')).toBe('/double/slashes')
  })

  it('decodes percent-encoding so encoded and literal paths match', () => {
    expect(normalizeRedirectPath('/caf%C3%A9')).toBe('/café')
    expect(normalizeRedirectPath('/bad%E0%A4%A')).toBe('/bad%e0%a4%a')
  })
})

describe('redirectTarget', () => {
  it('carries the request query string to a target without one', () => {
    expect(redirectTarget('/new', '?utm_source=x')).toBe('/new?utm_source=x')
    expect(redirectTarget('/new#section', '?a=1')).toBe('/new?a=1#section')
  })

  it('never overrides a target that sets its own query', () => {
    expect(redirectTarget('/new?ref=old', '?a=1')).toBe('/new?ref=old')
    expect(redirectTarget('/new', '')).toBe('/new')
  })
})

describe('redirectRuleSchema', () => {
  it('accepts site paths, absolute URLs, and target-less 410s', () => {
    expect(redirectRuleSchema.safeParse({ from: '/a', to: '/b' }).success).toBe(true)
    expect(redirectRuleSchema.safeParse({ from: '/a', to: 'https://x.test/b', statusCode: 308 }).success).toBe(true)
    expect(redirectRuleSchema.safeParse({ from: '/gone', to: '', statusCode: 410 }).success).toBe(true)
  })

  it('rejects missing targets, relative non-path targets, and self-redirects', () => {
    expect(redirectRuleSchema.safeParse({ from: '/a', to: '' }).success).toBe(false)
    expect(redirectRuleSchema.safeParse({ from: '/a', to: 'b' }).success).toBe(false)
    expect(redirectRuleSchema.safeParse({ from: '/a', to: 'javascript:alert(1)' }).success).toBe(false)
    expect(redirectRuleSchema.safeParse({ from: '/A/', to: '/a' }).success).toBe(false)
    expect(redirectRuleSchema.safeParse({ from: 'a', to: '/b' }).success).toBe(false)
    expect(redirectRuleSchema.safeParse({ from: '/a', to: '/b', statusCode: 303 }).success).toBe(false)
  })
})

describe('parseRedirectCsv', () => {
  it('parses rows with line numbers, skipping a header, blanks, and comments', () => {
    const { rules, lineErrors } = parseRedirectCsv('from,to,status\n/a,/b\n\n# comment\n/c,"https://x.test/?q=1,2",302\n/gone,,\n/d\t/e\t308\n/bad,/x,abc')
    expect(rules).toEqual([
      { line: 2, rule: { from: '/a', to: '/b', statusCode: 301 } },
      { line: 5, rule: { from: '/c', to: 'https://x.test/?q=1,2', statusCode: 302 } },
      { line: 6, rule: { from: '/gone', to: '', statusCode: 410 } },
      { line: 7, rule: { from: '/d', to: '/e', statusCode: 308 } },
    ])
    expect(lineErrors).toEqual([{ line: 8, message: 'Invalid status "abc"' }])
  })
})

describe('normalizeSeoSettings', () => {
  it('normalizes values and passes non-SEO keys through untouched', () => {
    const out = Object.fromEntries(normalizeSeoSettings([
      ['seo.canonical_url', 'https://example.com/'],
      ['seo.twitter_handle', '@brand'],
      ['seo.verify_google', '<meta name="google-site-verification" content="abc123XYZ" />'],
      ['seo.social_profiles', ['https://github.com/brand']],
      ['theme.primary_color', '#fff'],
    ]))
    expect(out['seo.canonical_url']).toBe('https://example.com')
    expect(out['seo.twitter_handle']).toBe('brand')
    expect(out['seo.verify_google']).toBe('abc123XYZ')
    expect(out['seo.social_profiles']).toEqual(['https://github.com/brand'])
    expect(out['theme.primary_color']).toBe('#fff')
  })

  it('accepts empty values for optional text settings', () => {
    expect(() => normalizeSeoSettings([['seo.canonical_url', ''], ['seo.og_image', ''], ['seo.twitter_handle', ''], ['seo.verify_bing', '']])).not.toThrow()
  })

  it('rejects unknown seo keys and invalid values with a 422 naming the key', () => {
    expect(() => normalizeSeoSettings([['seo.nonsense', 'x']])).toThrow(/Unknown SEO setting "seo.nonsense"/)
    expect(() => normalizeSeoSettings([['seo.canonical_url', 'example.com']])).toThrow(/seo.canonical_url/)
    expect(() => normalizeSeoSettings([['seo.ai_crawlers', 'maybe']])).toThrow(/seo.ai_crawlers/)
    expect(() => normalizeSeoSettings([['seo.social_profiles', ['not a url']]])).toThrow(/seo.social_profiles/)
    expect(() => normalizeSeoSettings([['seo.twitter_handle', 'way_too_long_for_twitter']])).toThrow(/seo.twitter_handle/)
  })

  it('only accepts real robots.txt directives in custom rules', () => {
    expect(() => normalizeSeoSettings([['seo.robots_custom', '# note\nUser-agent: Foo\nDisallow: /x\n\nCrawl-delay: 5']])).not.toThrow()
    expect(() => normalizeSeoSettings([['seo.robots_custom', 'User-agent: Foo\nblock everything please']])).toThrow(/seo.robots_custom/)
  })
})
