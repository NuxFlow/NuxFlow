<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useAiImprove, AI_IMPROVE_ACTIONS } from './useAiImprove'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editor = useEditor({
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
  ],
  content: props.modelValue ?? '',
  editorProps: { attributes: { class: 'nuxflow-richtext-input-prose' } },
  onUpdate({ editor: e }) {
    emit('update:modelValue', e.getHTML())
  },
})

watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  if (editor.value.getHTML() !== (val ?? '')) {
    editor.value.commands.setContent(val ?? '', { emitUpdate: false })
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

const boldActive = computed(() => editor.value?.isActive('bold') ?? false)
const italicActive = computed(() => editor.value?.isActive('italic') ?? false)
const bulletListActive = computed(() => editor.value?.isActive('bulletList') ?? false)
const orderedListActive = computed(() => editor.value?.isActive('orderedList') ?? false)
const linkActive = computed(() => editor.value?.isActive('link') ?? false)

function addLink() {
  const previousUrl = editor.value?.getAttributes('link').href as string | undefined
  const url = window.prompt('Link URL:', previousUrl || 'https://')
  if (url === null) return
  if (url === '') {
    editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.value?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

// ── AI text improvement ───────────────────────────────────────────────────────

const { aiLoading, aiAlternatives, showAiMenu, triggerAi: runAiImprove, dismissAlternatives } = useAiImprove()
const aiActions = AI_IMPROVE_ACTIONS

function triggerAi(instruction: typeof aiActions[number]['value']) {
  runAiImprove(instruction, editor.value?.getText() ?? '')
}

function applyAiAlternative(alt: string) {
  editor.value?.commands.setContent(`<p>${alt}</p>`)
  emit('update:modelValue', editor.value?.getHTML() ?? '')
  dismissAlternatives()
}
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-700 rounded-md overflow-visible focus-within:ring-2 focus-within:ring-primary-500">
    <!-- Formatting toolbar -->
    <div class="flex items-center gap-0.5 px-2 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <button
        type="button"
        title="Bold"
        class="w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors"
        :class="boldActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="editor?.chain().focus().toggleBold().run()"
      >B</button>

      <button
        type="button"
        title="Italic"
        class="w-6 h-6 flex items-center justify-center rounded text-xs italic transition-colors"
        :class="italicActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="editor?.chain().focus().toggleItalic().run()"
      >I</button>

      <div class="w-px h-3.5 bg-gray-300 dark:bg-gray-600 mx-0.5" />

      <button
        type="button"
        title="Bullet list"
        class="w-6 h-6 flex items-center justify-center rounded transition-colors"
        :class="bulletListActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="editor?.chain().focus().toggleBulletList().run()"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <button
        type="button"
        title="Numbered list"
        class="w-6 h-6 flex items-center justify-center rounded transition-colors"
        :class="orderedListActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="editor?.chain().focus().toggleOrderedList().run()"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <line x1="10" y1="6" x2="21" y2="6" stroke-linecap="round" stroke-width="2"/>
          <line x1="10" y1="12" x2="21" y2="12" stroke-linecap="round" stroke-width="2"/>
          <line x1="10" y1="18" x2="21" y2="18" stroke-linecap="round" stroke-width="2"/>
          <text x="3" y="7" font-size="5" fill="currentColor">1</text>
          <text x="3" y="13" font-size="5" fill="currentColor">2</text>
          <text x="3" y="19" font-size="5" fill="currentColor">3</text>
        </svg>
      </button>

      <div class="w-px h-3.5 bg-gray-300 dark:bg-gray-600 mx-0.5" />

      <button
        type="button"
        title="Insert link"
        class="w-6 h-6 flex items-center justify-center rounded transition-colors"
        :class="linkActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="addLink"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>

      <button
        type="button"
        title="Remove link"
        class="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        @mousedown.prevent="editor?.chain().focus().unsetLink().run()"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M3 3l18 18" />
        </svg>
      </button>

      <!-- AI improve button -->
      <div class="ml-auto relative">
        <button
          type="button"
          title="Improve with AI"
          :disabled="aiLoading"
          class="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-primary-500 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
          @mousedown.prevent="showAiMenu = !showAiMenu"
        >
          <span v-if="aiLoading" style="display:block;width:12px;height:12px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;" />
          <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </button>
        <div
          v-if="showAiMenu"
          class="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden"
          style="min-width: 120px;"
        >
          <button
            v-for="action in aiActions"
            :key="action.value"
            type="button"
            class="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            @mousedown.prevent="triggerAi(action.value)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Editable content area -->
    <EditorContent :editor="editor" class="nuxflow-richtext-input-content min-h-[80px] max-h-48 overflow-y-auto px-3 py-2 text-sm" />

    <!-- AI alternatives -->
    <div v-if="aiAlternatives.length" class="border-t border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1.5 bg-gray-50 dark:bg-gray-800/50">
      <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Pick an alternative:</p>
      <button
        v-for="(alt, i) in aiAlternatives"
        :key="i"
        type="button"
        class="w-full text-left text-xs px-2.5 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950 transition-colors"
        @click="applyAiAlternative(alt)"
      >
        {{ alt }}
      </button>
      <button
        type="button"
        class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        @click="dismissAlternatives()"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>

<style scoped>
.nuxflow-richtext-input-content :deep(.nuxflow-richtext-input-prose) {
  outline: none;
  color: #111827;
}
:global(.dark) .nuxflow-richtext-input-content :deep(.nuxflow-richtext-input-prose) {
  color: #f3f4f6;
}
.nuxflow-richtext-input-content :deep(a) { color: #3b82f6; text-decoration: underline; }
.nuxflow-richtext-input-content :deep(ul) { list-style: disc; padding-left: 1.25rem; }
.nuxflow-richtext-input-content :deep(ol) { list-style: decimal; padding-left: 1.25rem; }
.nuxflow-richtext-input-content :deep(p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #9ca3af;
  pointer-events: none;
  float: left;
  height: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
