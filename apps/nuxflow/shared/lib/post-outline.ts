// What a reader sees above a post: its reading time and table of contents. Worked out from
// the stored TipTap document, with heading ids made by the same headingId() the renderer
// (render-tiptap.ts) uses, so every TOC link lands on its heading. Import-free.

interface Node {
  type?: string
  attrs?: Record<string, unknown>
  content?: Node[]
  text?: string
}

/** Words read per minute — the usual figure for adults reading on screen. */
export const WORDS_PER_MINUTE = 230

/** Plain text of a node and everything inside it. */
export function nodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Node
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return ' '
  return (n.content ?? []).map(nodeText).join(n.type === 'doc' || n.type === 'bulletList' || n.type === 'orderedList' ? '\n' : '')
}

/**
 * A heading's anchor id: lower-case letters and digits of any script joined by hyphens
 * ("Costs & VAT" → "costs-vat"), made unique within one document by a counter ("faq",
 * "faq-2"). `used` is per document — pass the same Map for every heading in it.
 */
export function headingId(text: string, used: Map<string, number>): string {
  const base = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'section'
  const seen = used.get(base) ?? 0
  used.set(base, seen + 1)
  return seen ? `${base}-${seen + 1}` : base
}

/** Words in a piece of text; each Chinese/Japanese/Korean character counts as one. */
export function countWords(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const rest = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
  const words = rest.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)?.length ?? 0
  return words + cjk
}

export interface OutlineHeading {
  level: number
  text: string
  id: string
}

export interface PostOutline {
  /** Every heading, in order, with the id the renderer gives it. */
  headings: OutlineHeading[]
  words: number
  /** Whole minutes, at least 1 for any text at all; 0 for an empty document. */
  readingMinutes: number
}

export function postOutline(doc: unknown): PostOutline {
  const headings: OutlineHeading[] = []
  const used = new Map<string, number>()
  const walk = (node: Node) => {
    if (node.type === 'heading') {
      const text = nodeText(node).trim()
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      headings.push({ level, text, id: headingId(text, used) })
      return
    }
    for (const child of node.content ?? []) walk(child)
  }
  if (Array.isArray(doc)) doc.forEach(n => walk(n as Node))
  else if (doc && typeof doc === 'object') walk(doc as Node)

  const words = countWords(Array.isArray(doc) ? doc.map(nodeText).join('\n') : nodeText(doc))
  return { headings, words, readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0 }
}

/**
 * The headings a table of contents lists: level 2 and 3 (the post's own title is the page's
 * h1), and only when there are at least `min` of them — a short post doesn't need one.
 */
export function tocHeadings(outline: PostOutline, min = 3): OutlineHeading[] {
  const list = outline.headings.filter(h => (h.level === 2 || h.level === 3) && h.text)
  return list.length >= min ? list : []
}
