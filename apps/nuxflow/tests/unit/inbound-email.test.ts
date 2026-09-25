import { describe, it, expect } from 'vitest'
import {
  parseRecipient, parseAuthResults, isSenderAuthenticated, normalizeSubject,
  textToTipTap, makeSnippet, privateEmailKey,
} from '../../server/utils/inbound-email'
import { isValidMailboxLocalPart } from '../../server/utils/inbox'

describe('parseRecipient', () => {
  it('splits local part, sub-address tag and domain, lowercased', () => {
    expect(parseRecipient('Contact+Urgent@Acme.COM')).toEqual({ local: 'contact', tag: 'urgent', domain: 'acme.com' })
    expect(parseRecipient('leads@acme.com')).toEqual({ local: 'leads', tag: null, domain: 'acme.com' })
  })

  it('splits on the first + only, so a platform address keeps its mailbox part whole', () => {
    expect(parseRecipient('acme+post-abc@in.example.net')).toEqual({ local: 'acme', tag: 'post-abc', domain: 'in.example.net' })
  })

  it('treats an empty tag as none and strips a trailing dot from the domain', () => {
    expect(parseRecipient('acme+@in.example.net.')).toEqual({ local: 'acme', tag: null, domain: 'in.example.net' })
  })

  it('rejects malformed addresses', () => {
    expect(parseRecipient('no-at-sign')).toBeNull()
    expect(parseRecipient('@acme.com')).toBeNull()
    expect(parseRecipient('contact@')).toBeNull()
  })
})

describe('parseAuthResults', () => {
  it('reads spf, dkim and dmarc verdicts', () => {
    const header = 'mx.cloudflare.net; dkim=pass header.d=example.org header.s=s1; spf=pass smtp.mailfrom=example.org; dmarc=pass header.from=example.org'
    expect(parseAuthResults(header)).toEqual({ dkim: 'pass', spf: 'pass', dmarc: 'pass' })
  })

  it('keeps the first verdict for each method', () => {
    expect(parseAuthResults('x; dkim=fail; dkim=pass')).toEqual({ dkim: 'fail' })
  })

  it('returns nothing for a missing header', () => {
    expect(parseAuthResults(null)).toEqual({})
  })
})

describe('isSenderAuthenticated', () => {
  it('accepts a DKIM or DMARC pass', () => {
    expect(isSenderAuthenticated({ dkim: 'pass' })).toBe(true)
    expect(isSenderAuthenticated({ dmarc: 'pass', dkim: 'fail' })).toBe(true)
  })

  it('rejects SPF alone (it checks the envelope, not the From the user sees)', () => {
    expect(isSenderAuthenticated({ spf: 'pass' })).toBe(false)
    expect(isSenderAuthenticated({})).toBe(false)
  })
})

describe('normalizeSubject', () => {
  it('strips any number of reply/forward prefixes', () => {
    expect(normalizeSubject('Re: RE: Fwd: Pricing')).toBe('pricing')
    expect(normalizeSubject('AW: Re[2]: Order 42')).toBe('order 42')
  })

  it('leaves a subject without prefixes alone apart from case', () => {
    expect(normalizeSubject('Regarding your quote')).toBe('regarding your quote')
  })

  it('stays fast on a hostile subject', () => {
    const hostile = `${'re: '.repeat(5000)}x`
    const start = performance.now()
    normalizeSubject(hostile)
    expect(performance.now() - start).toBeLessThan(200)
  })
})

describe('textToTipTap', () => {
  it('makes a paragraph per blank-line block and hard breaks within one', () => {
    expect(textToTipTap('First line\nsecond line\n\nNext para')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'First line' }, { type: 'hardBreak' }, { type: 'text', text: 'second line' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Next para' }] },
    ])
  })

  it('drops a conventional "-- " signature', () => {
    expect(textToTipTap('Body\n-- \nJane\nSent from my phone')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
    ])
  })

  it('handles CRLF line endings', () => {
    expect(textToTipTap('One\r\n\r\nTwo')).toHaveLength(2)
  })
})

describe('makeSnippet / privateEmailKey', () => {
  it('collapses whitespace and caps at 200 chars', () => {
    expect(makeSnippet('  a\n\n b\tc ')).toBe('a b c')
    expect(makeSnippet('x'.repeat(500))).toHaveLength(200)
  })

  it('keeps received mail outside the public <siteId>/ media prefix', () => {
    const key = privateEmailKey('SITE1', 'MSG1', 'abc')
    expect(key.startsWith('SITE1/')).toBe(false)
    expect(key).toBe('_private/SITE1/email/MSG1-abc')
  })
})

describe('isValidMailboxLocalPart', () => {
  it('accepts ordinary local parts and the catch-all', () => {
    for (const ok of ['contact', 'sales.team', 'hello_world', 'a', '*']) expect(isValidMailboxLocalPart(ok)).toBe(true)
  })

  it('rejects the post-by-email namespace, reserved names, and malformed input', () => {
    for (const bad of ['post-abc', 'postmaster', 'abuse', 'noreply', 'a+b', '.dot', 'dot.', 'has space', '']) {
      expect(isValidMailboxLocalPart(bad)).toBe(false)
    }
  })
})
