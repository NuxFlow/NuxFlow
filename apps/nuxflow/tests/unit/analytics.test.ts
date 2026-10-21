import { describe, it, expect } from 'vitest'
import { analyticsSql, deviceClass, isLikelyBot, normalizeViewPath, referrerHost, reportDays } from '../../server/utils/analytics'

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

describe('isLikelyBot', () => {
  it('lets real browsers through', () => {
    expect(isLikelyBot(CHROME)).toBe(false)
    expect(isLikelyBot(IPHONE)).toBe(false)
  })

  it('catches known crawlers, headless browsers, tools and a missing user agent', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'curl/8.7.1',
      'python-requests/2.32.3',
      '',
      null,
    ]) {
      expect(isLikelyBot(ua), String(ua)).toBe(true)
    }
  })
})

describe('deviceClass', () => {
  it('tells phones, tablets and desktops apart', () => {
    expect(deviceClass(CHROME)).toBe('desktop')
    expect(deviceClass(IPHONE)).toBe('mobile')
    expect(deviceClass(IPAD)).toBe('tablet')
    expect(deviceClass(ANDROID_TABLET)).toBe('tablet')
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')).toBe('mobile')
  })
})

describe('referrerHost', () => {
  it('keeps only the host of an external referrer — never the path or query', () => {
    expect(referrerHost('https://www.google.com/search?q=private+thing', 'example.com')).toBe('google.com')
    expect(referrerHost('https://news.ycombinator.com/item?id=1', 'example.com')).toBe('news.ycombinator.com')
  })

  it('drops the site\'s own pages, non-web schemes and junk', () => {
    expect(referrerHost('https://example.com/blog', 'example.com')).toBe('')
    expect(referrerHost('https://www.example.com/blog', 'example.com:443')).toBe('')
    expect(referrerHost('android-app://com.google.android.gm/', 'example.com')).toBe('')
    expect(referrerHost('not a url', 'example.com')).toBe('')
    expect(referrerHost('', 'example.com')).toBe('')
  })
})

describe('normalizeViewPath', () => {
  it('counts public pages, without query, fragment or trailing slash', () => {
    expect(normalizeViewPath('/')).toBe('/')
    expect(normalizeViewPath('/blog/hello/?utm_source=x#top')).toBe('/blog/hello')
    expect(normalizeViewPath('/es/about')).toBe('/es/about')
  })

  it('refuses admin, account and sign-in pages, files, and anything that isn\'t a site path', () => {
    for (const p of ['/admin', '/admin/content', '/account', '/login', '/search', '/feed.xml', '/sitemap.xml', '/api/public/site', '//evil.example', '/\\evil.example', 'https://evil.example/', `/${'a'.repeat(300)}`]) {
      expect(normalizeViewPath(p), p).toBeNull()
    }
  })
})

describe('analyticsSql', () => {
  it('scopes every query to the site\'s own page views', () => {
    const sql = analyticsSql('nuxflow_analytics', '01JABCDEF', 30)
    for (const q of [sql.total, sql.previous!, sql.series, sql.pages, sql.countries, sql.referrers, sql.devices]) {
      expect(q).toContain('FROM nuxflow_analytics WHERE index1 = \'01JABCDEF\' AND blob1 = \'view\'')
      expect(q).toContain('_sample_interval')
    }
    expect(sql.total).toContain('INTERVAL \'29\' DAY')
  })

  it('has no previous period when it would be past the 90-day retention', () => {
    expect(analyticsSql('ds', 'site', 7).previous).not.toBeNull()
    expect(analyticsSql('ds', 'site', 90).previous).toBeNull()
  })

  it('refuses anything that could break out of the inlined values', () => {
    expect(() => analyticsSql('ds', 'x\' OR 1=1 --', 7)).toThrow()
    expect(() => analyticsSql('ds; DROP', 'site', 7)).toThrow()
    expect(() => analyticsSql('ds', 'site', 14 as 7)).toThrow()
  })
})

describe('reportDays', () => {
  it('lists the whole UTC days the report covers, oldest first, ending today', () => {
    expect(reportDays(7, new Date('2026-10-21T15:00:00Z'))).toEqual([
      '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21',
    ])
  })
})
