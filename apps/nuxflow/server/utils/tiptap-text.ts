/**
 * Extracts plain text from a TipTap/ProseMirror JSON document — a minimal, server-owned
 * equivalent of app/utils/render-tiptap.ts's HTML rendering, kept separate rather than
 * imported because that file is scoped to the Vue app bundle and cannot be imported from
 * Nitro server routes (see CLAUDE.md's "App utilities" section). Used by
 * api/public/listen/[slug].post.ts, which needs the article's spoken-word text server-side,
 * not HTML markup — a much smaller surface than full HTML rendering (no need to reproduce
 * heading levels, lists-as-markup, etc., just the words in reading order with paragraph
 * breaks preserved as sentence breaks for the TTS model to pace naturally).
 */
interface TiptapNode {
  type?: string
  text?: string
  content?: TiptapNode[]
}

export function extractPlainText(doc: unknown): string {
  const parts: string[] = []

  function walk(node: TiptapNode | undefined) {
    if (!node) return
    if (typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child)
    }
    // Paragraph/heading boundaries become sentence breaks so the TTS model doesn't run
    // separate blocks together with no pause.
    if (node.type === 'paragraph' || node.type === 'heading') parts.push('.\n')
  }

  walk(doc as TiptapNode)
  // Collapse whitespace, then collapse a run of punctuation left by a block boundary
  // landing right after text that already ended in its own '.'/'!'/'?' (e.g. "Hello
  // world." followed by the artificial block-boundary '.' below) down to one mark —
  // otherwise the source's own terminal punctuation and the artificial separator stack up
  // into "Hello world..".
  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+\./g, '.').replace(/([.!?])\.+/g, '$1').trim()
}
