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
        const href = esc(String(mark.attrs?.href ?? ''))
        const target = mark.attrs?.target
          ? ` target="${esc(String(mark.attrs.target))}" rel="noopener noreferrer"`
          : ''
        return `<a href="${href}"${target}>${acc}</a>`
      }
      case 'highlight': {
        const color = mark.attrs?.color
          ? ` style="background-color:${esc(String(mark.attrs.color))}"`
          : ''
        return `<mark${color}>${acc}</mark>`
      }
      case 'textStyle': {
        const color = mark.attrs?.color ? `color:${esc(String(mark.attrs.color))};` : ''
        const family = mark.attrs?.fontFamily ? `font-family:${esc(String(mark.attrs.fontFamily))};` : ''
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
      const src = esc(String(node.attrs?.src ?? ''))
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
