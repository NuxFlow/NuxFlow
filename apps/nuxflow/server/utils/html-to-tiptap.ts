// Converts WordPress `content:encoded` HTML into the TipTap JSON document shape the
// rest of NuxFlow stores in `content_items.content` (see app/utils/render-tiptap.ts for
// the inverse — TipTap JSON back to HTML — which this mirrors node-for-node so imported
// content renders exactly like natively-authored content).
//
// This is a small hand-rolled tokenizer + recursive-descent tree builder, not a full
// HTML5-spec parser: it assumes reasonably well-formed input (true of WordPress's own
// TinyMCE/Gutenberg-saved post content in practice) rather than implementing the spec's
// tag-soup error recovery. WordPress shortcodes ([gallery], [caption], etc.) aren't
// WordPress-core HTML and pass through untouched as literal text — there's no generic
// way to know what a third-party shortcode should become.

export interface TTNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TTNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

type Mark = { type: string; attrs?: Record<string, unknown> }

type Token =
  | { kind: 'open'; tag: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: 'close'; tag: string }
  | { kind: 'text'; text: string }

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])

// Covers the entities that actually show up in WordPress-authored content (curly quotes,
// dashes, ellipsis, nbsp, and the universal XML five) plus numeric/hex refs — not the
// full HTML5 named-entity table, which WP content essentially never uses beyond these.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
  nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', deg: '°',
  laquo: '«', raquo: '»',
}

export function decodeHtmlEntities(str: string): string {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X'
      const code = Number.parseInt(isHex ? ent.slice(2) : ent.slice(1), isHex ? 16 : 10)
      if (Number.isNaN(code)) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[ent] ?? whole
  })
}

export function stripHtmlToPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

// Unquoted attribute values explicitly exclude quote characters (rather than just
// whitespace/">") so that alternative never overlaps with the quoted-value branches —
// an overlapping alternation here is the classic shape that invites catastrophic
// backtracking on malformed input (see the similar note in server/utils/sanitize-css-svg.ts).
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/gi
const ATTR_RE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(html))) {
    if (m.index > last) tokens.push({ kind: 'text', text: html.slice(last, m.index) })
    last = TAG_RE.lastIndex
    const whole = m[0]!
    if (whole.startsWith('<!--')) continue // comment — Gutenberg block markers, etc.

    if (m[1] === '/') {
      tokens.push({ kind: 'close', tag: m[2]!.toLowerCase() })
      continue
    }

    const tag = m[2]!.toLowerCase()
    // Object.create(null): attribute names come from untrusted uploaded XML, and a plain
    // {} lets a crafted name like "__proto__" reach the prototype's own setter.
    const attrs: Record<string, string> = Object.create(null)
    ATTR_RE.lastIndex = 0
    let am: RegExpExecArray | null
    while ((am = ATTR_RE.exec(m[3] ?? ''))) {
      const name = am[1]!.toLowerCase()
      attrs[name] = decodeHtmlEntities(am[2] ?? am[3] ?? am[4] ?? '')
    }
    tokens.push({ kind: 'open', tag, attrs, selfClosing: m[4] === '/' || VOID_TAGS.has(tag) })
  }
  if (last < html.length) tokens.push({ kind: 'text', text: html.slice(last) })
  return tokens
}

const INLINE_MARK_TAGS: Record<string, string> = {
  strong: 'bold', b: 'bold',
  em: 'italic', i: 'italic',
  code: 'code',
  s: 'strike', strike: 'strike', del: 'strike',
  u: 'underline', ins: 'underline',
  sup: 'superscript',
  sub: 'subscript',
  a: 'link',
}

function inlineMarkFor(tag: string, attrs: Record<string, string>): Mark | null {
  const type = INLINE_MARK_TAGS[tag]
  if (!type) return null
  if (type === 'link') {
    return { type, attrs: { href: attrs.href ?? '', target: attrs.target || undefined } }
  }
  return { type }
}

function popMark(marks: Mark[], tag: string): void {
  const type = INLINE_MARK_TAGS[tag]
  if (!type) return
  const idx = marks.map(m => m.type).lastIndexOf(type)
  if (idx !== -1) marks.splice(idx, 1)
}

function withMarks(text: string, marks: Mark[]): TTNode {
  return marks.length ? { type: 'text', text, marks: marks.map(m => ({ ...m })) } : { type: 'text', text }
}

// Inline-only scan for contexts that hold text/marks/breaks but never nested block
// content in practice (heading titles). Stops at `stopTag`'s matching close.
function parseInline(tokens: Token[], start: number, stopTag: string): { nodes: TTNode[]; next: number } {
  const nodes: TTNode[] = []
  const marks: Mark[] = []
  let i = start
  while (i < tokens.length) {
    const t = tokens[i]!
    if (t.kind === 'close') {
      if (t.tag === stopTag) { i++; break }
      popMark(marks, t.tag)
      i++
      continue
    }
    if (t.kind === 'text') {
      const text = decodeHtmlEntities(t.text)
      if (text) nodes.push(withMarks(text, marks))
      i++
      continue
    }
    if (t.tag === 'br') { nodes.push({ type: 'hardBreak' }); i++; continue }
    const mark = inlineMarkFor(t.tag, t.attrs)
    if (mark && !t.selfClosing) { marks.push(mark); i++; continue }
    i++ // unknown/void inline tag (span, wbr, ...) — drop the tag, keep scanning
  }
  return { nodes, next: i }
}

function imageAttrs(attrs: Record<string, string>): Record<string, unknown> | null {
  if (!attrs.src) return null
  const out: Record<string, unknown> = { src: attrs.src }
  if (attrs.alt) out.alt = attrs.alt
  if (attrs.title) out.title = attrs.title
  const width = Number.parseInt(attrs.width ?? '', 10)
  const height = Number.parseInt(attrs.height ?? '', 10)
  if (Number.isFinite(width)) out.width = width
  if (Number.isFinite(height)) out.height = height
  return out
}

function parseTableRows(tokens: Token[], start: number): { rows: TTNode[]; next: number } {
  const rows: TTNode[] = []
  let i = start
  while (i < tokens.length) {
    const t = tokens[i]!
    if (t.kind === 'close' && t.tag === 'table') { i++; break }
    if (t.kind === 'open' && (t.tag === 'thead' || t.tag === 'tbody' || t.tag === 'tfoot')) { i++; continue }
    if (t.kind === 'close' && (t.tag === 'thead' || t.tag === 'tbody' || t.tag === 'tfoot')) { i++; continue }
    if (t.kind === 'open' && t.tag === 'tr') {
      const cells: TTNode[] = []
      let j = i + 1
      while (j < tokens.length) {
        const ct = tokens[j]!
        if (ct.kind === 'close' && ct.tag === 'tr') { j++; break }
        if (ct.kind === 'open' && (ct.tag === 'td' || ct.tag === 'th')) {
          const inner = parseBlocks(tokens, j + 1, ct.tag)
          cells.push({ type: ct.tag === 'th' ? 'tableHeader' : 'tableCell', content: inner.nodes.length ? inner.nodes : [{ type: 'paragraph' }] })
          j = inner.next
          continue
        }
        j++
      }
      rows.push({ type: 'tableRow', content: cells })
      i = j
      continue
    }
    i++
  }
  return { rows, next: i }
}

const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'figure', 'header', 'footer', 'figcaption'])
const HEADING_RE = /^h([1-6])$/

// Block-level parse: mixes loose inline runs (auto-wrapped into paragraphs, matching
// normal HTML flow content behavior) with recognized block children. Recurses for
// anything that can itself contain block content (blockquote, list items, table cells).
// Stops at `stopTag`'s matching close, or end of input when stopTag is null (document root).
function parseBlocks(tokens: Token[], start: number, stopTag: string | null): { nodes: TTNode[]; next: number } {
  const nodes: TTNode[] = []
  let inline: TTNode[] = []
  const marks: Mark[] = []
  let i = start

  const flush = () => {
    const hasContent = inline.some(n => n.type !== 'text' || (n.text && n.text.length > 0))
    if (hasContent) nodes.push({ type: 'paragraph', content: inline })
    inline = []
  }

  while (i < tokens.length) {
    const t = tokens[i]!

    if (t.kind === 'close') {
      if (stopTag && t.tag === stopTag) { i++; break }
      popMark(marks, t.tag)
      i++
      continue
    }

    if (t.kind === 'text') {
      const text = decodeHtmlEntities(t.text)
      if (text) inline.push(withMarks(text, marks))
      i++
      continue
    }

    const tag = t.tag

    if (tag === 'br') { inline.push({ type: 'hardBreak' }); i++; continue }

    if (tag === 'img') {
      const attrs = imageAttrs(t.attrs)
      if (attrs) { flush(); nodes.push({ type: 'image', attrs }) }
      i++
      continue
    }

    if (tag === 'hr') { flush(); nodes.push({ type: 'horizontalRule' }); i++; continue }

    const heading = HEADING_RE.exec(tag)
    if (heading) {
      flush()
      const level = Number(heading[1])
      const inner = t.selfClosing ? { nodes: [] as TTNode[], next: i + 1 } : parseInline(tokens, i + 1, tag)
      nodes.push({ type: 'heading', attrs: { level }, content: inner.nodes })
      i = inner.next
      continue
    }

    if (tag === 'p' || CONTAINER_TAGS.has(tag)) {
      flush()
      if (t.selfClosing) { i++; continue }
      const inner = parseBlocks(tokens, i + 1, tag)
      nodes.push(...inner.nodes)
      i = inner.next
      continue
    }

    if (tag === 'blockquote') {
      flush()
      const inner = t.selfClosing ? { nodes: [] as TTNode[], next: i + 1 } : parseBlocks(tokens, i + 1, tag)
      nodes.push({ type: 'blockquote', content: inner.nodes.length ? inner.nodes : [{ type: 'paragraph' }] })
      i = inner.next
      continue
    }

    if (tag === 'ul' || tag === 'ol') {
      flush()
      const items: TTNode[] = []
      let j = i + 1
      while (j < tokens.length) {
        const jt = tokens[j]!
        if (jt.kind === 'text' && !jt.text.trim()) { j++; continue }
        if (jt.kind === 'close' && jt.tag === tag) { j++; break }
        if (jt.kind === 'open' && jt.tag === 'li') {
          const inner = jt.selfClosing ? { nodes: [] as TTNode[], next: j + 1 } : parseBlocks(tokens, j + 1, 'li')
          items.push({ type: 'listItem', content: inner.nodes.length ? inner.nodes : [{ type: 'paragraph' }] })
          j = inner.next
          continue
        }
        j++ // stray token between <li>s — skip
      }
      nodes.push({ type: tag === 'ul' ? 'bulletList' : 'orderedList', content: items })
      i = j
      continue
    }

    if (tag === 'pre') {
      flush()
      let j = i + 1
      let raw = ''
      let language: string | undefined
      const codeOpen = tokens[j]
      if (codeOpen && codeOpen.kind === 'open' && codeOpen.tag === 'code') {
        const cls = codeOpen.attrs.class ?? ''
        const langMatch = /language-(\S+)/.exec(cls)
        if (langMatch) language = langMatch[1]
        j++
      }
      while (j < tokens.length) {
        const jt = tokens[j]!
        if (jt.kind === 'close' && jt.tag === 'pre') break
        if (jt.kind === 'text') raw += decodeHtmlEntities(jt.text)
        else if (jt.kind === 'open' && jt.tag === 'br') raw += '\n'
        j++
      }
      if (j < tokens.length) j++ // consume </pre>
      nodes.push({ type: 'codeBlock', attrs: language ? { language } : undefined, content: raw ? [{ type: 'text', text: raw }] : [] })
      i = j
      continue
    }

    if (tag === 'table') {
      flush()
      const inner = parseTableRows(tokens, i + 1)
      nodes.push({ type: 'table', content: [{ type: 'tableBody', content: inner.rows }] })
      i = inner.next
      continue
    }

    const mark = inlineMarkFor(tag, t.attrs)
    if (mark) {
      if (!t.selfClosing) marks.push(mark)
      i++
      continue
    }

    // Unknown tag we don't model (span, WP shortcode-adjacent wrappers, etc.) — drop the
    // tag itself but let its children keep flowing at this level.
    i++
  }

  flush()
  return { nodes, next: i }
}

export function htmlToTipTap(html: string): { type: 'doc'; content: TTNode[] } {
  if (!html || !html.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  const tokens = tokenize(html)
  const { nodes } = parseBlocks(tokens, 0, null)
  return { type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] }
}
