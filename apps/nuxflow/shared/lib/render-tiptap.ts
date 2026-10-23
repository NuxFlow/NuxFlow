// TipTap/ProseMirror JSON → HTML. The one renderer for stored prose content: public pages
// (NuxBlock.vue), the editor's readability input, and the RSS/Atom feeds all use it, so
// they can't drift apart on what's escaped or which nodes render.

import { parseVideoUrl, videoEmbedUrl, videoWatchUrl } from '@nuxflow/canvas/video'
import { escapeHtml } from './html-text'

interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  marks?: TipTapMark[]
  text?: string
}

interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

const esc = escapeHtml

/**
 * False for javascript:/vbscript:/data: URLs, which run code on click (link) or load (image).
 * Browsers strip every ASCII C0 control character (U+0000-U+001F) from a URL before reading
 * its scheme, so "\x01javascript:..." is the same as "javascript:..." — strip them first.
 */
export function isSafeLinkUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- stripping C0 controls is the point of this check
  return !/^(?:javascript|vbscript|data):/i.test(url.replace(/[\x00-\x1F]/g, '').trim())
}

// esc() only escapes HTML metacharacters; it doesn't stop a scheme that executes.
function escUrl(str: string): string {
  return isSafeLinkUrl(str) ? esc(str) : ''
}

// Allowlist for CSS color/font-family values written into an inline style="" attribute —
// esc() only escapes HTML metacharacters (& < > "), not CSS syntax, so an unescaped ";" lets
// an attacker append arbitrary trailing declarations (e.g. "red; position:fixed; inset:0").
const CSS_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.]+\)|hsla?\([\d\s,.%]+\)|[a-zA-Z]{2,30})$/
const CSS_FONT_FAMILY_RE = /^[a-z0-9\s,'"-]{1,100}$/i

function safeCssColor(value: string): string {
  const trimmed = value.trim()
  return CSS_COLOR_RE.test(trimmed) ? trimmed : ''
}

function safeFontFamily(value: string): string {
  const trimmed = value.trim()
  return CSS_FONT_FAMILY_RE.test(trimmed) ? trimmed : ''
}

function spanAttrs(node: TipTapNode): string {
  const cs = Math.floor(Number(node.attrs?.colspan ?? 1))
  const rs = Math.floor(Number(node.attrs?.rowspan ?? 1))
  return (cs > 1 ? ` colspan="${cs}"` : '') + (rs > 1 ? ` rowspan="${rs}"` : '')
}

function children(node: TipTapNode): string {
  return (node.content ?? []).map(renderNode).join('')
}

function withMarks(text: string, marks: TipTapMark[]): string {
  return marks.reduce((acc, mark) => {
    switch (mark.type) {
      case 'bold': return `<strong>${acc}</strong>`
      case 'italic': return `<em>${acc}</em>`
      case 'code': return `<code>${acc}</code>`
      case 'strike': return `<s>${acc}</s>`
      case 'underline': return `<u>${acc}</u>`
      case 'superscript': return `<sup>${acc}</sup>`
      case 'subscript': return `<sub>${acc}</sub>`
      case 'link': {
        const href = escUrl(String(mark.attrs?.href ?? ''))
        const target = mark.attrs?.target
          ? ` target="${esc(String(mark.attrs.target))}" rel="noopener noreferrer"`
          : ''
        return `<a href="${href}"${target}>${acc}</a>`
      }
      case 'highlight': {
        const safeColor = mark.attrs?.color ? safeCssColor(String(mark.attrs.color)) : ''
        const color = safeColor ? ` style="background-color:${safeColor}"` : ''
        return `<mark${color}>${acc}</mark>`
      }
      case 'textStyle': {
        const safeColor = mark.attrs?.color ? safeCssColor(String(mark.attrs.color)) : ''
        const safeFamily = mark.attrs?.fontFamily ? safeFontFamily(String(mark.attrs.fontFamily)) : ''
        const color = safeColor ? `color:${safeColor};` : ''
        const family = safeFamily ? `font-family:${safeFamily};` : ''
        const style = color + family
        return style ? `<span style="${style}">${acc}</span>` : acc
      }
      default: return acc
    }
  }, text)
}

function renderNode(node: TipTapNode): string {
  switch (node.type) {
    case 'doc':
      return children(node)

    case 'paragraph':
      return `<p>${children(node) || '<br>'}</p>`

    case 'heading': {
      const l = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `<h${l}>${children(node)}</h${l}>`
    }

    case 'text': {
      const escaped = esc(node.text ?? '')
      return node.marks?.length ? withMarks(escaped, node.marks) : escaped
    }

    case 'hardBreak':
      return '<br>'

    case 'horizontalRule':
      return '<hr>'

    case 'blockquote':
      return `<blockquote>${children(node)}</blockquote>`

    case 'bulletList':
      return `<ul>${children(node)}</ul>`

    case 'orderedList': {
      const start = Math.floor(Number(node.attrs?.start ?? 1))
      const attr = Number.isFinite(start) && start !== 1 ? ` start="${start}"` : ''
      return `<ol${attr}>${children(node)}</ol>`
    }

    case 'listItem':
      return `<li>${children(node)}</li>`

    case 'codeBlock': {
      const lang = node.attrs?.language
        ? ` class="language-${esc(String(node.attrs.language))}"`
        : ''
      const code = (node.content ?? []).map(n => esc(n.text ?? '')).join('')
      return `<pre><code${lang}>${code}</code></pre>`
    }

    case 'image': {
      const src = escUrl(String(node.attrs?.src ?? ''))
      const alt = node.attrs?.alt ? ` alt="${esc(String(node.attrs.alt))}"` : ''
      const title = node.attrs?.title ? ` title="${esc(String(node.attrs.title))}"` : ''
      const width = node.attrs?.width ? ` width="${esc(String(node.attrs.width))}"` : ''
      const height = node.attrs?.height ? ` height="${esc(String(node.attrs.height))}"` : ''
      return `<img src="${src}"${alt}${title}${width}${height} loading="lazy">`
    }

    case 'video':
      return renderVideo(node)

    case 'table':
      return `<table>${children(node)}</table>`

    case 'tableBody':
      return `<tbody>${children(node)}</tbody>`

    case 'tableRow':
      return `<tr>${children(node)}</tr>`

    case 'tableCell': {
      return `<td${spanAttrs(node)}>${children(node)}</td>`
    }

    case 'tableHeader': {
      return `<th${spanAttrs(node)}>${children(node)}</th>`
    }

    case 'taskList':
      return `<ul class="nux-task-list">${children(node)}</ul>`

    case 'taskItem': {
      const checked = node.attrs?.checked ? ' checked' : ''
      return `<li class="nux-task-item"><label><input type="checkbox" disabled${checked}><span>${children(node)}</span></label></li>`
    }

    default:
      return children(node)
  }
}

const VIDEO_RATIO: Record<string, string> = { '16:9': '56.25%', '4:3': '75%', '1:1': '100%', '9:16': '177.78%' }

/**
 * A video in a post (`video` node: url, caption, aspectRatio). YouTube and Vimeo get their
 * privacy-friendly player. A Cloudflare Stream video gets a player only when the public page
 * API marked it public (`privateVideo: false`); otherwise — private, or not marked, as in a
 * feed — a placeholder that NuxBlock.vue swaps for a signed player in the browser, with a
 * link for readers that don't run scripts.
 */
function renderVideo(node: TipTapNode): string {
  const ref = parseVideoUrl(node.attrs?.url)
  if (!ref) return ''
  const ratio = VIDEO_RATIO[String(node.attrs?.aspectRatio ?? '16:9')] ?? VIDEO_RATIO['16:9']
  const caption = typeof node.attrs?.caption === 'string' && node.attrs.caption.trim()
    ? `<figcaption>${esc(node.attrs.caption.trim())}</figcaption>`
    : ''
  const frame = `position:relative;padding-bottom:${ratio};height:0;overflow:hidden;border-radius:8px;background:#000`
  const inner = ref.provider === 'stream' && node.attrs?.privateVideo !== false
    ? `<div class="nux-video-frame" style="${frame}" data-nuxflow-video="${ref.id}"><a href="${esc(videoWatchUrl(ref))}" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff">Watch the video</a></div>`
    : `<div class="nux-video-frame" style="${frame}"><iframe src="${esc(videoEmbedUrl(ref))}" title="${esc(String(node.attrs?.caption || 'Video'))}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`
  return `<figure class="nux-video">${inner}${caption}</figure>`
}

export function renderTipTap(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const node = doc as TipTapNode
  if (Array.isArray(doc)) return (doc as TipTapNode[]).map(renderNode).join('')
  return renderNode(node)
}
