<script setup lang="ts">
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
  // `aiBar` is defined just below this call — safe because TipTap only invokes
  // `onSelectionUpdate` later, well after both consts in this module have been assigned
  // (see the comment above `aiBar`'s declaration).
  onSelectionUpdate({ editor: e }) {
    aiBar.handleSelectionUpdate(e)
  },
})

// Selection-tracking/positioning logic for the floating AI toolbar that appears above a
// text selection. Declared right after `editor` (not destructured) because the
// `onSelectionUpdate` callback passed to `useEditor` above already references `aiBar` by
// name — that's a forward reference that only works because the callback isn't actually
// invoked until well after this line has run.
const aiBar = useTipTapAiSelectionBar(editor)

// Link-insert panel — replaces window.prompt() with an inline panel matching the rest of
// this toolbar's chrome.
const linkPanel = useLinkPanel(editor)

watch(() => props.modelValue, (val) => {
  if (!editor.value || !val) return
  if (JSON.stringify(editor.value.getJSON()) !== JSON.stringify(val))
    editor.value.commands.setContent(val as object, { emitUpdate: false })
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

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

// ── AI modals ─────────────────────────────────────────────────────────────────

const showGenerateModal = ref(false)
const showGrammarPanel = ref(false)

// ── Toolbar definition ────────────────────────────────────────────────────────

const { tools } = useTipTapToolbar(editor, {
  onInsertImage: () => { isMediaModalOpen.value = true },
  onSetLink: () => linkPanel.setLink(),
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
          :aria-label="item.label"
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
          aria-label="Generate content with AI"
          title="Generate content with AI"
          @click="showGenerateModal = true"
        />
        <UButton
          icon="i-lucide-spell-check"
          size="xs"
          :color="showGrammarPanel ? 'primary' : 'neutral'"
          :variant="showGrammarPanel ? 'soft' : 'ghost'"
          aria-label="Grammar & spell check"
          title="Grammar & spell check"
          @click="showGrammarPanel = !showGrammarPanel"
        />
      </div>
    </div>

    <!-- Link panel -->
    <div
      v-if="linkPanel.showLinkPanel.value"
      class="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <input
          :ref="(el) => { linkPanel.linkUrlInputRef.value = el as HTMLInputElement | null }"
          v-model="linkPanel.linkUrlDraft.value"
          type="text"
          placeholder="https://example.com"
          class="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
          @keydown.enter.prevent="linkPanel.confirmLink()"
          @keydown.escape.prevent="linkPanel.cancelLink()"
        >
        <UButton size="xs" variant="ghost" @click="linkPanel.cancelLink()">Cancel</UButton>
        <UButton size="xs" color="primary" @click="linkPanel.confirmLink()">{{ linkPanel.linkUrlDraft.value.trim() ? 'Apply' : 'Remove link' }}</UButton>
      </div>
      <p v-if="linkPanel.linkUrlError.value" class="text-xs text-red-500 mt-1.5">{{ linkPanel.linkUrlError.value }}</p>
    </div>

    <!-- Grammar panel -->
    <EditorGrammarPanel
      v-if="showGrammarPanel"
      :editor="editor"
      @close="showGrammarPanel = false"
    />

    <!-- Editable area -->
    <div class="flex-1 px-5 py-4 cursor-text" @click="editor?.commands.focus()">
      <EditorContent :editor="editor" class="h-full" />
    </div>

    <!-- Floating AI toolbar — appears above text selections -->
    <Teleport to="body">
      <div
        v-if="aiBar.showAiSelectionBar.value && aiBar.aiSelectionText.value"
        class="ai-selection-bar"
        :style="aiBar.aiBarStyle.value"
        @mousedown.prevent
      >
        <EditorAiToolbar
          :selected-text="aiBar.aiSelectionText.value"
          @replace="aiBar.onAiReplace"
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
        <EditorGenerateModal
          :editor="editor"
          @close="showGenerateModal = false"
          @update:model-value="emit('update:modelValue', $event)"
        />
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
