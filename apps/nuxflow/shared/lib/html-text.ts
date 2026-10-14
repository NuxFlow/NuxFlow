// Small, dependency-free HTML text helpers shared by the server (html-to-tiptap.ts) and the
// browser (the WordPress import parses its export file client-side).

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
