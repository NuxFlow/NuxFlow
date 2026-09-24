/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Editor } from '@tiptap/vue-3'

export interface ToolItem {
  icon: string
  label: string
  action: () => void
  active?: boolean
  disabled?: boolean
}

export interface ToolGroup {
  group: string
  items: ToolItem[]
}

/**
 * Derives the prose toolbar's button groups from live editor state (active marks/nodes).
 * Extracted from ContentEditor.client.vue — same spirit as useLinkPanel/
 * useTipTapAiSelectionBar there: this is pure derived data with no DOM/lifecycle of its
 * own, so it doesn't need to live inline with the TipTap instance setup.
 */
export function useTipTapToolbar(
  editor: Ref<Editor | undefined>,
  opts: { onInsertImage: () => void; onSetLink: () => void },
) {
  const tools = computed((): ToolGroup[] => {
    const e = editor.value
    if (!e) return []
    return [
      {
        group: 'history',
        items: [
          { icon: 'i-lucide-undo-2', label: 'Undo', action: () => e.chain().focus().undo().run() },
          { icon: 'i-lucide-redo-2', label: 'Redo', action: () => e.chain().focus().redo().run() },
        ],
      },
      {
        group: 'headings',
        items: [
          { icon: 'i-lucide-heading-1', label: 'Heading 1', active: e.isActive('heading', { level: 1 }), action: () => (e.chain().focus() as any).toggleHeading({ level: 1 }).run() },
          { icon: 'i-lucide-heading-2', label: 'Heading 2', active: e.isActive('heading', { level: 2 }), action: () => (e.chain().focus() as any).toggleHeading({ level: 2 }).run() },
          { icon: 'i-lucide-heading-3', label: 'Heading 3', active: e.isActive('heading', { level: 3 }), action: () => (e.chain().focus() as any).toggleHeading({ level: 3 }).run() },
        ],
      },
      {
        group: 'marks',
        items: [
          { icon: 'i-lucide-bold', label: 'Bold', active: e.isActive('bold'), action: () => (e.chain().focus() as any).toggleBold().run() },
          { icon: 'i-lucide-italic', label: 'Italic', active: e.isActive('italic'), action: () => (e.chain().focus() as any).toggleItalic().run() },
          { icon: 'i-lucide-underline', label: 'Underline', active: e.isActive('underline'), action: () => (e.chain().focus() as any).toggleUnderline().run() },
          { icon: 'i-lucide-strikethrough', label: 'Strikethrough', active: e.isActive('strike'), action: () => (e.chain().focus() as any).toggleStrike().run() },
          { icon: 'i-lucide-highlighter', label: 'Highlight', active: e.isActive('highlight'), action: () => (e.chain().focus() as any).toggleHighlight().run() },
          { icon: 'i-lucide-code', label: 'Inline code', active: e.isActive('code'), action: () => (e.chain().focus() as any).toggleCode().run() },
        ],
      },
      {
        group: 'links',
        items: [
          { icon: 'i-lucide-link', label: 'Link', active: e.isActive('link'), action: () => opts.onSetLink() },
          ...(e.isActive('link') ? [
            { icon: 'i-lucide-unlink', label: 'Remove Link', action: () => e.chain().focus().unsetLink().run() },
          ] : []),
        ],
      },
      {
        group: 'blocks',
        items: [
          { icon: 'i-lucide-list', label: 'Bullet list', active: e.isActive('bulletList'), action: () => (e.chain().focus() as any).toggleBulletList().run() },
          { icon: 'i-lucide-list-ordered', label: 'Ordered list', active: e.isActive('orderedList'), action: () => (e.chain().focus() as any).toggleOrderedList().run() },
          { icon: 'i-lucide-text-quote', label: 'Blockquote', active: e.isActive('blockquote'), action: () => (e.chain().focus() as any).toggleBlockquote().run() },
          { icon: 'i-lucide-square-code', label: 'Code block', active: e.isActive('codeBlock'), action: () => (e.chain().focus() as any).toggleCodeBlock().run() },
          { icon: 'i-lucide-minus', label: 'Divider', action: () => (e.chain().focus() as any).setHorizontalRule().run() },
        ],
      },
      {
        group: 'tables',
        items: [
          { icon: 'i-lucide-table', label: 'Insert Table', action: () => (e.chain().focus() as any).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
          ...(e.isActive('table') ? [
            { icon: 'i-lucide-row-insert-top', label: 'Add Row Above', action: () => (e.chain().focus() as any).addRowBefore().run() },
            { icon: 'i-lucide-row-insert-bottom', label: 'Add Row Below', action: () => (e.chain().focus() as any).addRowAfter().run() },
            { icon: 'i-lucide-column-insert-left', label: 'Add Column Left', action: () => (e.chain().focus() as any).addColumnBefore().run() },
            { icon: 'i-lucide-column-insert-right', label: 'Add Column Right', action: () => (e.chain().focus() as any).addColumnAfter().run() },
            { icon: 'i-lucide-square-minus', label: 'Delete Row', action: () => (e.chain().focus() as any).deleteRow().run() },
            { icon: 'i-lucide-square-minus', label: 'Delete Column', action: () => (e.chain().focus() as any).deleteColumn().run() },
            { icon: 'i-lucide-trash-2', label: 'Delete Table', action: () => (e.chain().focus() as any).deleteTable().run() },
          ] : []),
        ],
      },
      {
        group: 'inserts',
        items: [
          { icon: 'i-lucide-image', label: 'Insert Image', action: () => opts.onInsertImage() },
        ],
      },
    ]
  })

  return { tools }
}
