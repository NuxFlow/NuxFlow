import { FilterXSS } from 'xss'

// Canvas block content is stored as raw HTML strings (rich-text editor output, or literal
// HTML for HtmlBlock) and rendered with v-html — with no server-side shape validation on
// write (block `content` is opaque JSON), sanitizing here at the v-html boundary is the one
// chokepoint that protects every source (admin editor, AI-generated blocks, WordPress import,
// MCP tool writes) regardless of how the string got into the database.

const richTextWhiteList = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [], strike: [],
  a: ['href', 'target', 'rel'],
  ul: [], ol: ['start'], li: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  blockquote: [], code: [], pre: [],
  span: ['style'], mark: ['style'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  table: [], thead: [], tbody: [], tr: [],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
  hr: [], sub: [], sup: [],
}

const richTextFilter = new FilterXSS({
  whiteList: richTextWhiteList,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
})

// HtmlBlock exists specifically for custom/embed HTML (e.g. iframes), so it keeps a wider
// whitelist than the rich-text block — but script execution is never a legitimate use case
// for either, so scripts, event handlers, and javascript:/data: URIs stay blocked in both.
const customHtmlFilter = new FilterXSS({
  whiteList: {
    ...richTextWhiteList,
    div: ['class', 'style'],
    section: ['class', 'style'],
    figure: ['class', 'style'],
    figcaption: [],
    iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'title', 'loading'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
})

export function sanitizeRichText(html: string | null | undefined): string {
  return richTextFilter.process(html ?? '')
}

export function sanitizeCustomHtml(html: string | null | undefined): string {
  return customHtmlFilter.process(html ?? '')
}

// Link-type block props (Button/Hero/CTA/Footer/Pricing/GDPR/Calendar) bind straight to
// `:href` with no surrounding HTML for the xss-library filters above to sanitize — content
// is stored as opaque, unvalidated JSON (block `props` have no server-side shape/scheme
// validation), so a `javascript:` URL in any of these fields would otherwise execute on
// click. Only the URI scheme needs blocking here, matching the same javascript:/vbscript:/
// data: blocklist used for TipTap links/images in app/utils/render-tiptap.ts.
export function safeHref(url: string | null | undefined): string {
  const trimmed = (url ?? '').trim()
  if (!trimmed) return ''
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return '#'
  return trimmed
}
