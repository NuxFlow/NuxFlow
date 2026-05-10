<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

const props = defineProps<{ modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const editor = useEditor({
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: 'Start writing your content here…' }),
  ],
  content: (props.modelValue as object) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  editorProps: { attributes: { class: 'nux-editor-prose' } },
  onUpdate({ editor: e }) {
    emit('update:modelValue', e.getJSON())
  },
})

watch(() => props.modelValue, (val) => {
  if (!editor.value || !val) return
  if (JSON.stringify(editor.value.getJSON()) !== JSON.stringify(val))
    editor.value.commands.setContent(val as object, { emitUpdate: false })
})

onBeforeUnmount(() => editor.value?.destroy())

interface ToolItem {
  icon: string
  label: string
  action: () => void
  active?: boolean
  disabled?: boolean
}

interface ToolGroup {
  group: string
  items: ToolItem[]
}

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
        { icon: 'i-lucide-heading-1', label: 'Heading 1', active: e.isActive('heading', { level: 1 }), action: () => e.chain().focus().toggleHeading({ level: 1 }).run() },
        { icon: 'i-lucide-heading-2', label: 'Heading 2', active: e.isActive('heading', { level: 2 }), action: () => e.chain().focus().toggleHeading({ level: 2 }).run() },
        { icon: 'i-lucide-heading-3', label: 'Heading 3', active: e.isActive('heading', { level: 3 }), action: () => e.chain().focus().toggleHeading({ level: 3 }).run() },
      ],
    },
    {
      group: 'marks',
      items: [
        { icon: 'i-lucide-bold', label: 'Bold', active: e.isActive('bold'), action: () => e.chain().focus().toggleBold().run() },
        { icon: 'i-lucide-italic', label: 'Italic', active: e.isActive('italic'), action: () => e.chain().focus().toggleItalic().run() },
        { icon: 'i-lucide-strikethrough', label: 'Strikethrough', active: e.isActive('strike'), action: () => e.chain().focus().toggleStrike().run() },
        { icon: 'i-lucide-code', label: 'Inline code', active: e.isActive('code'), action: () => e.chain().focus().toggleCode().run() },
      ],
    },
    {
      group: 'blocks',
      items: [
        { icon: 'i-lucide-list', label: 'Bullet list', active: e.isActive('bulletList'), action: () => e.chain().focus().toggleBulletList().run() },
        { icon: 'i-lucide-list-ordered', label: 'Ordered list', active: e.isActive('orderedList'), action: () => e.chain().focus().toggleOrderedList().run() },
        { icon: 'i-lucide-text-quote', label: 'Blockquote', active: e.isActive('blockquote'), action: () => e.chain().focus().toggleBlockquote().run() },
        { icon: 'i-lucide-square-code', label: 'Code block', active: e.isActive('codeBlock'), action: () => e.chain().focus().toggleCodeBlock().run() },
        { icon: 'i-lucide-minus', label: 'Divider', action: () => e.chain().focus().setHorizontalRule().run() },
      ],
    },
  ]
})
</script>

<template>
  <div class="flex flex-col min-h-[400px]">
    <!-- Toolbar -->
    <div
      v-if="editor"
      class="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/50"
    >
      <template v-for="group in tools" :key="group.group">
        <UButton
          v-for="item in group.items"
          :key="item.label"
          :icon="item.icon"
          :title="item.label"
          size="xs"
          :color="item.active ? 'primary' : 'neutral'"
          :variant="item.active ? 'soft' : 'ghost'"
          :disabled="item.disabled ?? false"
          @click="item.action()"
        />
        <div class="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1 last:hidden" />
      </template>
    </div>

    <!-- Editable area -->
    <div class="flex-1 px-5 py-4 cursor-text" @click="editor?.commands.focus()">
      <EditorContent :editor="editor" class="h-full" />
    </div>
  </div>
</template>

<style>
.nux-editor-prose {
  outline: none;
  min-height: 320px;
  line-height: 1.75;
  color: #111827;
}
.dark .nux-editor-prose { color: #f3f4f6; }

.nux-editor-prose p.is-empty:first-child::before {
  content: attr(data-placeholder);
  color: #9ca3af;
  pointer-events: none;
  float: left;
  height: 0;
}

.nux-editor-prose > * + * { margin-top: 0.75rem; }
.nux-editor-prose p { margin: 0; }
.nux-editor-prose h1 { font-size: 2rem; font-weight: 700; line-height: 1.2; }
.nux-editor-prose h2 { font-size: 1.5rem; font-weight: 700; line-height: 1.3; }
.nux-editor-prose h3 { font-size: 1.25rem; font-weight: 600; line-height: 1.4; }
.nux-editor-prose h4 { font-size: 1.125rem; font-weight: 600; }
.nux-editor-prose strong { font-weight: 700; }
.nux-editor-prose em { font-style: italic; }
.nux-editor-prose s { text-decoration: line-through; }
.nux-editor-prose code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875em;
  background: rgba(0,0,0,.06);
  padding: .1em .35em;
  border-radius: .25rem;
}
.dark .nux-editor-prose code { background: rgba(255,255,255,.1); }
.nux-editor-prose pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 1rem 1.25rem;
  border-radius: .5rem;
  overflow-x: auto;
  font-size: .875rem;
}
.nux-editor-prose pre code { background: none; padding: 0; }
.nux-editor-prose blockquote {
  border-left: 3px solid #00dc82;
  padding-left: 1rem;
  color: #6b7280;
  font-style: italic;
}
.nux-editor-prose ul { list-style: disc; padding-left: 1.5rem; }
.nux-editor-prose ol { list-style: decimal; padding-left: 1.5rem; }
.nux-editor-prose li + li { margin-top: .25rem; }
.nux-editor-prose hr { border: none; border-top: 1px solid rgba(0,0,0,.12); margin: 1.5rem 0; }
.dark .nux-editor-prose hr { border-top-color: rgba(255,255,255,.12); }
</style>
