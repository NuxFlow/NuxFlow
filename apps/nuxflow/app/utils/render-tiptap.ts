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

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Blocks javascript:/vbscript:/data: URIs in href/src — esc() only escapes HTML metacharacters,
// it doesn't stop a scheme that executes on click (link) or load (image).
function escUrl(str: string): string {
  // Browsers strip every ASCII C0 control character (U+0000-U+001F, which includes but isn't
  // limited to tab/newline/carriage-return) from a URL during parsing before evaluating its
  // scheme, so "\x01javascript:..." parses identically to "javascript:...". Strip the whole
  // C0 range before the scheme test, not just whitespace-like characters.
  // eslint-disable-next-line no-control-regex -- stripping C0 controls is the point of this check
  const trimmed = str.replace(/[\x00-\x1F]/g, '').trim()
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return ''
  return esc(str)
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
      const start = Number(node.attrs?.start ?? 1)
      const attr = start !== 1 ? ` start="${start}"` : ''
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

    case 'table':
      return `<table>${children(node)}</table>`

    case 'tableBody':
      return `<tbody>${children(node)}</tbody>`

    case 'tableRow':
      return `<tr>${children(node)}</tr>`

    case 'tableCell': {
      const cs = Number(node.attrs?.colspan ?? 1) > 1 ? ` colspan="${node.attrs!.colspan}"` : ''
      const rs = Number(node.attrs?.rowspan ?? 1) > 1 ? ` rowspan="${node.attrs!.rowspan}"` : ''
      return `<td${cs}${rs}>${children(node)}</td>`
    }

    case 'tableHeader': {
      const cs = Number(node.attrs?.colspan ?? 1) > 1 ? ` colspan="${node.attrs!.colspan}"` : ''
      const rs = Number(node.attrs?.rowspan ?? 1) > 1 ? ` rowspan="${node.attrs!.rowspan}"` : ''
      return `<th${cs}${rs}>${children(node)}</th>`
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

export function renderTipTap(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const node = doc as TipTapNode
  if (Array.isArray(doc)) return (doc as TipTapNode[]).map(renderNode).join('')
  return renderNode(node)
}
