<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'

const props = defineProps<{ modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const CODE_LANGUAGES = [
  { label: 'Plain text', value: '' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Vue', value: 'vue' },
  { label: 'JSX / TSX', value: 'tsx' },
  { label: 'JSON', value: 'json' },
  { label: 'Python', value: 'python' },
  { label: 'PHP', value: 'php' },
  { label: 'SQL', value: 'sql' },
  { label: 'Bash / Shell', value: 'bash' },
  { label: 'YAML', value: 'yaml' },
]

const isMediaModalOpen = ref(false)

// ── AI: floating selection toolbar ───────────────────────────────────────────

const aiSelectionText = ref('')
const aiSelectionFrom = ref(0)
const aiSelectionTo = ref(0)
const showAiSelectionBar = ref(false)
const aiBarX = ref(0)
const aiBarY = ref(0)
let selectionDebounce: ReturnType<typeof setTimeout>

const aiBarStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${aiBarY.value}px`,
  left: `${Math.min(aiBarX.value, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 310)}px`,
  transform: 'translateY(-100%) translateY(-8px)',
  zIndex: 9999,
}))

function onAiReplace(text: string) {
  editor.value?.chain()
    .focus()
    .setTextSelection({ from: aiSelectionFrom.value, to: aiSelectionTo.value })
    .insertContent(text)
    .run()
  showAiSelectionBar.value = false
  aiSelectionText.value = ''
}

function setLink() {
  if (!editor.value) return
  const previousUrl = editor.value.getAttributes('link').href
  const url = window.prompt('Enter URL:', previousUrl || '')

  if (url === null) {
    return
  }

  if (url === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }

  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

// ─────────────────────────────────────────────────────────────────────────────

const editor = useEditor({
  extensions: [
    StarterKit,
    Image.configure({
      inline: true,
      allowBase64: true,
    }),
    Placeholder.configure({ placeholder: 'Start writing your content here…' }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
    }),
    Underline,
    Highlight,
    TableKit.configure({
      table: {
        resizable: true,
      },
    }),
  ],
  content: (props.modelValue as object) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  editorProps: { attributes: { class: 'nux-editor-prose' } },
  onUpdate({ editor: e }) {
    emit('update:modelValue', e.getJSON())
  },
  onSelectionUpdate({ editor: e }) {
    clearTimeout(selectionDebounce)
    const { from, to, empty } = e.state.selection
    if (!empty) {
      const text = e.state.doc.textBetween(from, to, ' ').trim()
      if (text.length > 3) {
        aiSelectionFrom.value = from
        aiSelectionTo.value = to
        aiSelectionText.value = text
        const coords = e.view.coordsAtPos(from)
        aiBarX.value = coords.left
        aiBarY.value = coords.top
        selectionDebounce = setTimeout(() => { showAiSelectionBar.value = true }, 350)
        return
      }
    }
    // Selection cleared or too short — hide bar (debounced so clicks inside bar don't close it)
    selectionDebounce = setTimeout(() => {
      if (!showAiSelectionBar.value) aiSelectionText.value = ''
    }, 200)
  },
})

watch(() => props.modelValue, (val) => {
  if (!editor.value || !val) return
  if (JSON.stringify(editor.value.getJSON()) !== JSON.stringify(val))
    editor.value.commands.setContent(val as object, { emitUpdate: false })
})

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
})

onBeforeUnmount(() => {
  editor.value?.destroy()
  document.removeEventListener('mousedown', onDocMouseDown)
  clearTimeout(selectionDebounce)
})

function onDocMouseDown(e: MouseEvent) {
  const target = e.target as Element
  if (!target.closest('.ai-selection-bar')) {
    showAiSelectionBar.value = false
  }
}

const isCodeBlockActive = computed(() => editor.value?.isActive('codeBlock') ?? false)

const codeBlockLanguage = computed({
  get() {
    return (editor.value?.getAttributes('codeBlock').language as string | undefined) ?? ''
  },
  set(lang: string) {
    editor.value?.chain().focus().updateAttributes('codeBlock', { language: lang || null }).run()
  },
})

// ── Media ─────────────────────────────────────────────────────────────────────

function onMediaSelect(file: { url: string; altText?: string }) {
  editor.value?.chain().focus().setImage({ src: file.url, alt: file.altText || '' }).run()
  isMediaModalOpen.value = false
}

// ── AI: Generate content ──────────────────────────────────────────────────────

const showGenerateModal = ref(false)
const generateDescription = ref('')
const generateTone = ref<'professional' | 'casual' | 'friendly' | 'technical'>('professional')
const generateFormat = ref<'prose' | 'listicle' | 'howto' | 'faq'>('prose')
const generating = ref(false)
const generateError = ref('')

const toneOptions = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Friendly', value: 'friendly' },
  { label: 'Technical', value: 'technical' },
]

const formatOptions = [
  { label: 'Prose', value: 'prose' },
  { label: 'Listicle', value: 'listicle' },
  { label: 'How-to guide', value: 'howto' },
  { label: 'FAQ', value: 'faq' },
]

async function generateContent() {
  if (generateDescription.value.length < 5) return
  generating.value = true
  generateError.value = ''
  try {
    const { html } = await $fetch<{ html: string }>('/api/v1/ai/generate-content', {
      method: 'POST',
      body: { description: generateDescription.value, tone: generateTone.value, format: generateFormat.value },
    })
    editor.value?.commands.setContent(html)
    emit('update:modelValue', editor.value?.getJSON())
    showGenerateModal.value = false
    generateDescription.value = ''
  } catch {
    generateError.value = 'Generation failed. Check your AI provider settings.'
  } finally {
    generating.value = false
  }
}

// ── AI: Grammar check ─────────────────────────────────────────────────────────

interface Correction {
  original: string
  corrected: string
  reason: string
}

const showGrammarPanel = ref(false)
const grammarLoading = ref(false)
const corrections = ref<Correction[]>([])
const grammarChecked = ref(false)

function extractPlainText(): string {
  if (!editor.value) return ''
  return editor.value.getText()
}

async function checkGrammar() {
  const text = extractPlainText()
  if (!text.trim()) return
  grammarLoading.value = true
  corrections.value = []
  grammarChecked.value = false
  try {
    const res = await $fetch<{ corrections: Correction[] }>('/api/v1/ai/grammar', {
      method: 'POST',
      body: { text },
    })
    corrections.value = res.corrections
    grammarChecked.value = true
  } finally {
    grammarLoading.value = false
  }
}

function applyCorrection(c: Correction) {
  if (!editor.value) return
  const { state, dispatch } = editor.value.view
  const { doc, tr } = state
  let found = false
  doc.descendants((node, pos) => {
    if (found || node.type.name !== 'text') return
    const idx = node.text?.indexOf(c.original) ?? -1
    if (idx === -1) return
    const from = pos + idx
    const to = from + c.original.length
    dispatch(tr.replaceWith(from, to, state.schema.text(c.corrected)))
    found = true
  })
  corrections.value = corrections.value.filter(x => x !== c)
}

// ── Toolbar definition ────────────────────────────────────────────────────────

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
        { icon: 'i-lucide-link', label: 'Link', active: e.isActive('link'), action: () => setLink() },
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
        { icon: 'i-lucide-image', label: 'Insert Image', action: () => { isMediaModalOpen.value = true } },
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

      <select
        v-if="isCodeBlockActive"
        v-model="codeBlockLanguage"
        class="ml-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
        title="Code language"
      >
        <option v-for="lang in CODE_LANGUAGES" :key="lang.value" :value="lang.value">{{ lang.label }}</option>
      </select>

      <!-- AI toolbar -->
      <div class="ml-auto flex items-center gap-1">
        <div class="w-px h-4 bg-gray-200 dark:bg-gray-700 mr-1" />
        <UButton
          icon="i-lucide-sparkles"
          size="xs"
          color="primary"
          variant="ghost"
          title="Generate content with AI"
          @click="showGenerateModal = true"
        />
        <UButton
          icon="i-lucide-spell-check"
          size="xs"
          :color="showGrammarPanel ? 'primary' : 'neutral'"
          :variant="showGrammarPanel ? 'soft' : 'ghost'"
          title="Grammar & spell check"
          @click="showGrammarPanel = !showGrammarPanel; showGrammarPanel && checkGrammar()"
        />
      </div>
    </div>

    <!-- Grammar panel -->
    <div
      v-if="showGrammarPanel"
      class="border-b border-gray-200 dark:border-gray-800 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3"
    >
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <UIcon name="i-lucide-spell-check" class="w-3.5 h-3.5" />
          Grammar &amp; Style
        </p>
        <div class="flex items-center gap-2">
          <UButton size="xs" variant="ghost" :loading="grammarLoading" icon="i-lucide-refresh-cw" @click="checkGrammar">
            Re-check
          </UButton>
          <UButton size="xs" variant="ghost" icon="i-lucide-x" @click="showGrammarPanel = false" />
        </div>
      </div>
      <div v-if="grammarLoading" class="text-xs text-gray-400 flex items-center gap-1.5 py-1">
        <UIcon name="i-lucide-loader-2" class="w-3.5 h-3.5 animate-spin" />
        Checking…
      </div>
      <div v-else-if="grammarChecked && corrections.length === 0" class="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5 py-1">
        <UIcon name="i-lucide-check-circle" class="w-3.5 h-3.5" />
        No issues found.
      </div>
      <div v-else class="space-y-1.5 max-h-40 overflow-y-auto">
        <div
          v-for="(c, i) in corrections"
          :key="i"
          class="flex items-start gap-2 rounded-lg bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs"
        >
          <div class="flex-1 min-w-0">
            <span class="text-red-500 line-through">{{ c.original }}</span>
            <span class="mx-1 text-gray-400">→</span>
            <span class="text-green-600 dark:text-green-400 font-medium">{{ c.corrected }}</span>
            <span class="ml-2 text-gray-400">{{ c.reason }}</span>
          </div>
          <UButton size="xs" variant="ghost" color="success" @click="applyCorrection(c)">Apply</UButton>
        </div>
      </div>
    </div>

    <!-- Editable area -->
    <div class="flex-1 px-5 py-4 cursor-text" @click="editor?.commands.focus()">
      <EditorContent :editor="editor" class="h-full" />
    </div>

    <!-- Floating AI toolbar — appears above text selections -->
    <Teleport to="body">
      <div
        v-if="showAiSelectionBar && aiSelectionText"
        class="ai-selection-bar"
        :style="aiBarStyle"
        @mousedown.prevent
      >
        <EditorAiToolbar
          :selected-text="aiSelectionText"
          @replace="onAiReplace"
        />
      </div>
    </Teleport>

    <!-- Media Modal -->
    <UModal v-model:open="isMediaModalOpen" title="Select Media">
      <template #body>
        <EditorMediaPicker @select="onMediaSelect" />
      </template>
    </UModal>

    <!-- AI Generate Modal -->
    <UModal v-model:open="showGenerateModal" title="Generate content with AI">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Describe what you want to write">
            <UTextarea
              v-model="generateDescription"
              :rows="3"
              placeholder="e.g. An introduction to Cloudflare Workers explaining what they are and why developers should use them."
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Tone">
              <USelect v-model="generateTone" :items="toneOptions" />
            </UFormField>
            <UFormField label="Format">
              <USelect v-model="generateFormat" :items="formatOptions" />
            </UFormField>
          </div>
          <p v-if="generateError" class="text-sm text-red-500">{{ generateError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showGenerateModal = false">Cancel</UButton>
          <UButton
            icon="i-lucide-sparkles"
            :loading="generating"
            :disabled="generateDescription.length < 5"
            @click="generateContent"
          >
            Generate
          </UButton>
        </div>
      </template>
    </UModal>
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
.nux-editor-prose img { max-width: 100%; height: auto; border-radius: 0.5rem; margin-top: 1rem; margin-bottom: 1rem; display: inline-block; }

.nux-editor-prose a {
  color: #00dc82;
  text-decoration: underline;
  cursor: pointer;
}
.nux-editor-prose u {
  text-decoration: underline;
}
.nux-editor-prose mark {
  background-color: rgba(253, 224, 71, 0.4);
  border-radius: 0.125rem;
  padding: 0.1em 0.2em;
}
.dark .nux-editor-prose mark {
  background-color: rgba(253, 224, 71, 0.3);
  color: #f3f4f6;
}

/* Table styles */
.nux-editor-prose table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin: 1.5rem 0;
  overflow: hidden;
}

.nux-editor-prose th,
.nux-editor-prose td {
  border: 1px solid #e5e7eb;
  padding: 0.5rem 0.75rem;
  min-width: 1em;
  position: relative;
  text-align: left;
  vertical-align: top;
}

.dark .nux-editor-prose th,
.dark .nux-editor-prose td {
  border-color: #374151;
}

.nux-editor-prose th {
  background-color: #f9fafb;
  font-weight: 600;
}

.dark .nux-editor-prose th {
  background-color: #1f2937;
}

.nux-editor-prose .selectedCell::after {
  background: rgba(59, 130, 246, 0.08);
  content: "";
  left: 0; right: 0; top: 0; bottom: 0;
  pointer-events: none;
  position: absolute;
  z-index: 2;
}

.nux-editor-prose .column-resize-handle {
  background-color: #3b82f6;
  bottom: -2px;
  position: absolute;
  right: -2px;
  top: 0;
  width: 4px;
  z-index: 10;
  cursor: col-resize;
}
</style>
