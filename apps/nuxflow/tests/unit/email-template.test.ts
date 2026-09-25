import { describe, it, expect } from 'vitest'
import { renderEmailTemplate } from '../../server/utils/email-template'
import { describeUserAgent } from '../../server/utils/security-alerts'

describe('renderEmailTemplate', () => {
  it('escapes every piece of caller text', () => {
    const { html } = renderEmailTemplate({
      siteName: '<b>Acme</b>',
      heading: '<img src=x onerror=alert(1)>',
      paragraphs: ['<script>alert(1)</script>'],
      footnote: '"quoted" & <tags>',
      action: { label: '<i>Go</i>', url: 'https://acme.test/?a=1&b=<2>' },
    })
    expect(html).not.toMatch(/<script>|<img src=x|<i>Go|<b>Acme/)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('https://acme.test/?a=1&amp;b=&lt;2&gt;')
  })

  it('never puts a non-http(s) URL into an href', () => {
    const { html } = renderEmailTemplate({ siteName: 'Acme', paragraphs: [], action: { label: 'Go', url: 'javascript:alert(1)' } })
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('href="#"')
  })

  it('only accepts a hex accent colour', () => {
    const bad = renderEmailTemplate({ siteName: 'A', paragraphs: [], accentColor: 'red;background:url(x)' }).html
    expect(bad).toContain('#10b981')
    expect(bad).not.toContain('url(x)')
    expect(renderEmailTemplate({ siteName: 'A', paragraphs: [], accentColor: '#ff0000' }).html).toContain('#ff0000')
  })

  it('produces a plain-text part with the link spelled out', () => {
    const { text } = renderEmailTemplate({
      siteName: 'Acme',
      heading: 'Reset your password',
      paragraphs: ['Hi Jane,'],
      action: { label: 'Reset password', url: 'https://acme.test/r' },
    })
    expect(text).toBe('Reset your password\n\nHi Jane,\n\nReset password: https://acme.test/r\n\n— Acme')
  })

  it('turns newlines inside a paragraph into <br>', () => {
    expect(renderEmailTemplate({ siteName: 'A', paragraphs: ['a\nb'] }).html).toContain('a<br>b')
  })
})

describe('describeUserAgent', () => {
  it('names common browser/OS pairs, ignoring versions', () => {
    const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    const edgeWin = `${chromeWin} Edg/140.0`
    const safariIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const firefoxMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0'
    expect(describeUserAgent(chromeWin)).toEqual({ browser: 'Chrome', os: 'Windows' })
    expect(describeUserAgent(edgeWin)).toEqual({ browser: 'Edge', os: 'Windows' })
    expect(describeUserAgent(safariIos)).toEqual({ browser: 'Safari', os: 'iOS' })
    expect(describeUserAgent(firefoxMac)).toEqual({ browser: 'Firefox', os: 'macOS' })
  })

  it('falls back for missing or unknown agents', () => {
    expect(describeUserAgent(null)).toEqual({ browser: 'an unknown browser', os: 'an unknown system' })
  })
})
