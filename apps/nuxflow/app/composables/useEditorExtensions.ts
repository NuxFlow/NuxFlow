// TipTap extension configuration for the NuxFlow block editor
// UEditor from Nuxt UI Pro handles extension registration internally.
// This composable exposes the canonical extension config for reference and custom blocks.

export function useEditorExtensions() {
  // Extensions enabled via UEditor's built-in TipTap integration
  const extensions = {
    document: true,
    paragraph: true,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    image: true,
    video: true,
    bulletList: true,
    orderedList: true,
    blockquote: true,
    codeBlock: true,
    horizontalRule: true,
    table: true,
    dragHandle: true,
    history: true,
    link: true,
    bold: true,
    italic: true,
    strike: true,
    underline: true,
    highlight: true,
  }

  return { extensions }
}
