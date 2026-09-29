/**
 * Server-side Markdown rendering of content items, for AI agents and LLM tooling:
 * the per-page Markdown alternate (`/slug.md`, or `Accept: text/markdown` on the page URL
 * itself — see server/middleware/06.markdown.ts) and `/llms-full.txt`.
 *
 * Implemented here rather than relying on Cloudflare's own Markdown for Agents because
 * that is a per-zone setting only available on Pro plans and up — this works for every
 * tenant regardless of which zone/plan their domain sits on. (If a zone does have it
 * enabled, Cloudflare converts the HTML response instead; both paths emit the site's own
 * Content-Signal, so they agree.)
 *
 * Kept independent of app/utils/render-tiptap.ts for the same reason tiptap-text.ts is:
 * that file is scoped to the Vue bundle and can't be imported from Nitro.
 */

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Escapes the characters that would otherwise change Markdown inline formatting. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]]/g, ch => `\\${ch}`)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      } catch {
        return m
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m
  })
}

/** Blocks script-executing link targets the same way feed.xml's escUrl() does. */
function safeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return ''
  return trimmed.replace(/\s/g, '%20').replace(/\)/g, '%29')
}

function tidy(md: string): string {
  return md
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── HTML → Markdown ──────────────────────────────────────────────────────────

interface HtmlTag { name: string; closing: boolean; selfClosing: boolean; attrs: Record<string, string> }

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let i = 0
  while (i < src.length) {
    while (i < src.length && /[\s/]/.test(src[i]!)) i++
    let name = ''
    while (i < src.length && !/[\s=/>]/.test(src[i]!)) name += src[i++]
    if (!name) { i++; continue }
    while (i < src.length && /\s/.test(src[i]!)) i++
    let value = ''
    if (src[i] === '=') {
      i++
      while (i < src.length && /\s/.test(src[i]!)) i++
      const quote = src[i]
      if (quote === '"' || quote === '\'') {
        const end = src.indexOf(quote, i + 1)
        value = src.slice(i + 1, end === -1 ? src.length : end)
        i = end === -1 ? src.length : end + 1
      } else {
        while (i < src.length && !/[\s>]/.test(src[i]!)) value += src[i++]
      }
    }
    attrs[name.toLowerCase()] = decodeEntities(value)
  }
  return attrs
}

function parseTag(raw: string): HtmlTag | null {
  let body = raw.slice(1, -1).trim()
  const closing = body.startsWith('/')
  if (closing) body = body.slice(1).trim()
  const selfClosing = body.endsWith('/')
  if (selfClosing) body = body.slice(0, -1)
  let n = 0
  while (n < body.length && /[a-z0-9]/i.test(body[n]!)) n++
  if (n === 0) return null
  return { name: body.slice(0, n).toLowerCase(), closing, selfClosing, attrs: closing ? {} : parseAttrs(body.slice(n)) }
}

const SKIP_CONTENT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'head'])
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'table', 'tbody', 'thead', 'dl', 'dt', 'dd', 'nav'])

/**
 * Converts an HTML fragment (a Canvas text block's rich-text body, a raw HTML block) to
 * Markdown. A small linear scanner, not a regex pipeline — this runs on user-authored
 * HTML, so it must not have super-linear backtracking paths.
 */
export function htmlToMarkdown(html: string): string {
  // Each frame collects output; blockquote/pre/link frames are post-processed on close.
  type Frame = { tag: string; out: string; href?: string }
  const stack: Frame[] = [{ tag: '#root', out: '' }]
  const lists: { ordered: boolean; n: number }[] = []
  let skipUntil: string | null = null
  let inPre = 0

  const top = () => stack[stack.length - 1]!
  const emit = (s: string) => { top().out += s }

  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    const textEnd = lt === -1 ? html.length : lt
    if (textEnd > i && !skipUntil) {
      const raw = decodeEntities(html.slice(i, textEnd))
      emit(inPre ? raw : escapeMarkdown(raw.replace(/\s+/g, ' ')))
    }
    if (lt === -1) break

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end === -1 ? html.length : end + 3
      continue
    }
    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) {
      if (!skipUntil) emit(escapeMarkdown(html.slice(lt)))
      break
    }
    i = gt + 1
    const tag = parseTag(html.slice(lt, gt + 1))
    if (!tag) continue

    if (skipUntil) {
      if (tag.closing && tag.name === skipUntil) skipUntil = null
      continue
    }
    if (!tag.closing && SKIP_CONTENT_TAGS.has(tag.name)) {
      if (!tag.selfClosing) skipUntil = tag.name
      continue
    }

    const { name } = tag
    if (/^h[1-6]$/.test(name)) {
      emit(tag.closing ? '\n\n' : `\n\n${'#'.repeat(Number(name[1]))} `)
    } else if (BLOCK_TAGS.has(name)) {
      emit('\n\n')
    } else if (name === 'br') {
      emit(inPre ? '\n' : '  \n')
    } else if (name === 'hr') {
      emit('\n\n---\n\n')
    } else if (name === 'strong' || name === 'b') {
      emit('**')
    } else if (name === 'em' || name === 'i') {
      emit('_')
    } else if (name === 's' || name === 'del' || name === 'strike') {
      emit('~~')
    } else if (name === 'code' && !inPre) {
      emit('`')
    } else if (name === 'img' && !tag.closing) {
      const src = safeUrl(tag.attrs.src ?? '')
      if (src) emit(`![${escapeMarkdown(tag.attrs.alt ?? '')}](${src})`)
    } else if (name === 'a') {
      if (!tag.closing) {
        stack.push({ tag: 'a', out: '', href: safeUrl(tag.attrs.href ?? '') })
      } else if (top().tag === 'a') {
        const frame = stack.pop()!
        const text = frame.out.trim()
        emit(frame.href && text ? `[${text}](${frame.href})` : text)
      }
    } else if (name === 'ul' || name === 'ol') {
      if (!tag.closing) lists.push({ ordered: name === 'ol', n: 0 })
      else lists.pop()
      emit('\n')
    } else if (name === 'li') {
      if (!tag.closing) {
        const list = lists[lists.length - 1]
        const indent = '  '.repeat(Math.max(0, lists.length - 1))
        const marker = list?.ordered ? `${++list.n}. ` : '- '
        emit(`\n${indent}${marker}`)
      }
    } else if (name === 'blockquote') {
      if (!tag.closing) {
        stack.push({ tag: 'blockquote', out: '' })
      } else if (top().tag === 'blockquote') {
        const frame = stack.pop()!
        const quoted = tidy(frame.out).split('\n').map(l => `> ${l}`.trimEnd()).join('\n')
        emit(`\n\n${quoted}\n\n`)
      }
    } else if (name === 'pre') {
      if (!tag.closing) {
        inPre++
        stack.push({ tag: 'pre', out: '' })
      } else if (top().tag === 'pre') {
        inPre = Math.max(0, inPre - 1)
        const frame = stack.pop()!
        emit(`\n\n\`\`\`\n${frame.out.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`)
      }
    } else if (name === 'tr') {
      emit(tag.closing ? ' |' : '\n|')
    } else if (name === 'td' || name === 'th') {
      if (!tag.closing) emit(' ')
      else emit(' |')
    }
  }

  // Unclosed frames (malformed HTML): fold their text back in rather than lose it.
  while (stack.length > 1) {
    const frame = stack.pop()!
    top().out += frame.out
  }
  return tidy(stack[0]!.out.replace(/ \| \|/g, ' |'))
}

// ── TipTap → Markdown ────────────────────────────────────────────────────────

interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: TiptapNode[]
}

function inlineToMarkdown(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return ''
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '  \n'
    if (n.type === 'image') {
      const src = safeUrl(String(n.attrs?.src ?? ''))
      return src ? `![${escapeMarkdown(String(n.attrs?.alt ?? ''))}](${src})` : ''
    }
    if (typeof n.text !== 'string') return inlineToMarkdown(n.content)
    let t = escapeMarkdown(n.text)
    let href = ''
    for (const mark of n.marks ?? []) {
      switch (mark.type) {
        case 'bold': t = `**${t}**`; break
        case 'italic': t = `_${t}_`; break
        case 'strike': t = `~~${t}~~`; break
        case 'code': t = `\`${n.text.replace(/`/g, '\\`')}\``; break
        case 'link': href = safeUrl(String(mark.attrs?.href ?? '')); break
      }
    }
    return href ? `[${t}](${href})` : t
  }).join('')
}

function blockToMarkdown(node: TiptapNode, depth: number): string {
  const children = node.content ?? []
  switch (node.type) {
    case 'doc':
      return children.map(c => blockToMarkdown(c, depth)).join('\n\n')
    case 'paragraph':
      return inlineToMarkdown(children)
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2))
      return `${'#'.repeat(level)} ${inlineToMarkdown(children)}`
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const ordered = node.type === 'orderedList'
      const start = Number(node.attrs?.start) || 1
      return children.map((item, idx) => {
        const marker = ordered ? `${start + idx}. ` : '- '
        const body = (item.content ?? []).map(c => blockToMarkdown(c, depth + 1)).join('\n')
        const indent = '  '.repeat(depth)
        const lines = body.split('\n')
        return `${indent}${marker}${lines[0] ?? ''}${lines.slice(1).map(l => `\n${l.startsWith('  ') || /^\s*(?:[-*]|\d+\.)\s/.test(l) ? l : `${indent}  ${l}`}`).join('')}`
      }).join('\n')
    }
    case 'blockquote':
      return children.map(c => blockToMarkdown(c, depth)).join('\n\n').split('\n').map(l => `> ${l}`.trimEnd()).join('\n')
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `\`\`\`${lang}\n${children.map(c => c.text ?? '').join('')}\n\`\`\``
    }
    case 'horizontalRule':
      return '---'
    case 'image':
      return inlineToMarkdown([node])
    case 'table': {
      const rows = children.map(row => (row.content ?? []).map(cell =>
        (cell.content ?? []).map(c => blockToMarkdown(c, depth)).join(' ').replace(/\|/g, '\\|').replace(/\n+/g, ' ')))
      if (rows.length === 0) return ''
      const width = Math.max(...rows.map(r => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? '').join(' | ')} |`
      return [line(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
    }
    default:
      return typeof node.text === 'string'
        ? inlineToMarkdown([node])
        : children.map(c => blockToMarkdown(c, depth)).join('\n\n')
  }
}

export function tiptapToMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  return tidy(blockToMarkdown(doc as TiptapNode, 0))
}

// ── Canvas → Markdown ────────────────────────────────────────────────────────

interface CanvasBlock { type?: string; props?: Record<string, unknown>; children?: Record<string, CanvasBlock[]> }

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

function parseJsonList<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[]
  if (typeof v !== 'string' || !v.trim()) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function imageUrl(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return (v as { url: string }).url
  return ''
}

function link(label: string, url: string): string {
  const safe = safeUrl(url)
  return label && safe && safe !== '#' ? `[${escapeMarkdown(label)}](${safe})` : ''
}

function heading(level: number, text: string): string {
  return text ? `${'#'.repeat(level)} ${escapeMarkdown(text)}` : ''
}

function para(text: string): string {
  return text ? escapeMarkdown(text) : ''
}

// Prop keys rendered by the generic fallback for blocks without a dedicated case (e.g.
// a dynamic plugin's block), in reading order.
const GENERIC_HEADING_KEYS = ['headline', 'title', 'heading', 'sectionTitle']
const GENERIC_TEXT_KEYS = ['subtitle', 'subtext', 'description', 'sectionDesc', 'text', 'quote', 'caption', 'body']

function canvasBlockToMarkdown(block: CanvasBlock): string {
  const p = block.props ?? {}
  const parts: string[] = []
  const push = (...xs: string[]) => { for (const x of xs) if (x) parts.push(x) }

  switch (block.type) {
    case 'canvas-hero':
      push(heading(2, s(p.headline)), para(s(p.subtext)), link(s(p.ctaLabel), s(p.ctaUrl)), link(s(p.cta2Label), s(p.cta2Url)))
      break
    case 'canvas-text':
      push(htmlToMarkdown(s(p.content)))
      break
    case 'html-block/html':
      push(htmlToMarkdown(s(p.html)))
      break
    case 'canvas-image': {
      const url = safeUrl(imageUrl(p.src))
      if (url) push(`![${escapeMarkdown(s(p.alt))}](${url})`)
      push(para(s(p.caption)))
      break
    }
    case 'canvas-gallery':
    case 'canvas-carousel':
      for (const img of parseJsonList<{ url?: string; alt?: string }>(p.images)) {
        const url = safeUrl(imageUrl(img))
        if (url) push(`![${escapeMarkdown(s(img.alt))}](${url})`)
      }
      break
    case 'canvas-video':
      push(link('Watch the video', s(p.url)))
      break
    case 'canvas-features': {
      push(heading(2, s(p.sectionTitle) || s(p.sectionLabel)), para(s(p.sectionDesc)))
      for (let n = 1; n <= 4; n++) {
        const title = s(p[`feat${n}Title`])
        const desc = s(p[`feat${n}Desc`])
        if (title || desc) push([heading(3, title), para(desc)].filter(Boolean).join('\n\n'))
      }
      break
    }
    case 'canvas-testimonial': {
      const quote = s(p.quote)
      if (quote) push(`> ${escapeMarkdown(quote)}`)
      const who = [s(p.author), s(p.role), s(p.company)].filter(Boolean).join(', ')
      if (who) push(`— ${escapeMarkdown(who)}`)
      break
    }
    case 'canvas-cta':
      push(heading(2, s(p.headline)), para(s(p.subtext)), link(s(p.btnLabel), s(p.btnUrl)))
      break
    case 'canvas-button':
      push(link(s(p.label), s(p.url)))
      break
    case 'canvas-accordion': {
      push(heading(2, s(p.title)), para(s(p.description)))
      for (const item of parseJsonList<{ question?: string; answer?: string }>(p.itemsJson)) {
        if (s(item.question)) push(heading(3, s(item.question)), para(s(item.answer)))
      }
      break
    }
    case 'canvas-pricing': {
      push(heading(2, s(p.title)), para(s(p.description)))
      const plans = Number(s(p.numPlans)) || 2
      for (let n = 1; n <= Math.min(plans, 3); n++) {
        const name = s(p[`plan${n}Name`])
        if (!name) continue
        const price = [s(p[`plan${n}Price`]), s(p[`plan${n}Period`])].filter(Boolean).join('')
        const features = parseJsonList<string>(p[`plan${n}Features`]).map(f => `- ${escapeMarkdown(String(f))}`).join('\n')
        push([heading(3, price ? `${name} — ${price}` : name), features, link(s(p[`plan${n}BtnLabel`]), s(p[`plan${n}BtnUrl`]))].filter(Boolean).join('\n\n'))
      }
      break
    }
    // Pure chrome/interactive blocks with nothing an agent needs to read.
    case 'canvas-spacer':
    case 'canvas-gdpr':
    case 'canvas-footer':
    case 'canvas-calendar':
    case 'canvas-posts':
    case 'contact-form/form':
    case 'dynamic-form/form':
    case 'payments/memberships':
      break
    default: {
      const headingKey = GENERIC_HEADING_KEYS.find(k => s(p[k]))
      if (headingKey) push(heading(2, s(p[headingKey])))
      for (const k of GENERIC_TEXT_KEYS) push(para(s(p[k])))
      if (typeof p.content === 'string' && p.content.includes('<')) push(htmlToMarkdown(p.content))
    }
  }

  // Layout blocks (columns/container) carry their content in slot children.
  for (const slot of Object.values(block.children ?? {})) {
    for (const child of slot ?? []) push(canvasBlockToMarkdown(child))
  }
  return parts.join('\n\n')
}

export function canvasToMarkdown(content: unknown): string {
  const blocks = (content as { blocks?: CanvasBlock[] } | null)?.blocks
  if (!Array.isArray(blocks)) return ''
  return tidy(blocks.map(canvasBlockToMarkdown).filter(Boolean).join('\n\n'))
}

/** Markdown body of a content item, whichever editor produced it. */
export function contentToMarkdown(content: unknown): string {
  if (content && typeof content === 'object' && (content as { type?: string }).type === 'canvas') {
    return canvasToMarkdown(content)
  }
  if (typeof content === 'string') return htmlToMarkdown(content)
  return tiptapToMarkdown(content)
}

export interface MarkdownPageMeta {
  title: string
  url: string
  description?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  author?: string | null
  locale?: string | null
}

/**
 * A full Markdown document for one page: YAML front matter (the same shape Cloudflare's
 * own Markdown for Agents emits), an H1, and the body.
 */
export function pageToMarkdown(meta: MarkdownPageMeta, content: unknown): string {
  const fm: string[] = ['---', `title: ${JSON.stringify(meta.title)}`, `url: ${JSON.stringify(meta.url)}`]
  if (meta.description) fm.push(`description: ${JSON.stringify(meta.description)}`)
  if (meta.author) fm.push(`author: ${JSON.stringify(meta.author)}`)
  if (meta.locale) fm.push(`language: ${JSON.stringify(meta.locale)}`)
  if (meta.publishedAt) fm.push(`published: ${JSON.stringify(meta.publishedAt)}`)
  if (meta.updatedAt) fm.push(`updated: ${JSON.stringify(meta.updatedAt)}`)
  fm.push('---')
  const body = contentToMarkdown(content)
  return `${fm.join('\n')}\n\n# ${escapeMarkdown(meta.title)}\n\n${body}\n`
}
