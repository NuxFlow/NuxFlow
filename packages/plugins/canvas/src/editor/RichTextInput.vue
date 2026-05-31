<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editorRef = ref<HTMLDivElement>()
// Guard against triggering a watch loop when we set innerHTML programmatically
let settingInternally = false

onMounted(() => {
  if (editorRef.value)
    editorRef.value.innerHTML = props.modelValue ?? ''
})

watch(() => props.modelValue, (val) => {
  if (settingInternally) return
  if (editorRef.value && editorRef.value.innerHTML !== val)
    editorRef.value.innerHTML = val ?? ''
})

function onInput() {
  settingInternally = true
  emit('update:modelValue', editorRef.value?.innerHTML ?? '')
  setTimeout(() => { settingInternally = false }, 0)
}

// execCommand is deprecated from the spec but still works in all browsers for
// basic admin-UI formatting — it has no viable replacement for inline formatting
function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value)
  editorRef.value?.focus()
  onInput()
}

function addLink() {
  const url = prompt('Link URL:', 'https://')
  if (url) exec('createLink', url)
}

function isActive(cmd: string): boolean {
  try { return document.queryCommandState(cmd) } catch { return false }
}

const boldActive = ref(false)
const italicActive = ref(false)

function updateState() {
  boldActive.value = isActive('bold')
  italicActive.value = isActive('italic')
}
</script>

<template>
  <div class="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-primary-500">
    <!-- Formatting toolbar -->
    <div class="flex items-center gap-0.5 px-2 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <button
        type="button"
        title="Bold"
        class="w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors"
        :class="boldActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="exec('bold')"
      >B</button>

      <button
        type="button"
        title="Italic"
        class="w-6 h-6 flex items-center justify-center rounded text-xs italic transition-colors"
        :class="italicActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'"
        @mousedown.prevent="exec('italic')"
      >I</button>

      <div class="w-px h-3.5 bg-gray-300 dark:bg-gray-600 mx-0.5" />

      <button
        type="button"
        title="Bullet list"
        class="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        @mousedown.prevent="exec('insertUnorderedList')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <button
        type="button"
        title="Numbered list"
        class="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        @mousedown.prevent="exec('insertOrderedList')"
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
        class="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
        @mousedown.prevent="exec('unlink')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M3 3l18 18" />
        </svg>
      </button>
    </div>

    <!-- Editable content area -->
    <div
      ref="editorRef"
      contenteditable="true"
      class="min-h-[80px] max-h-48 overflow-y-auto px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none"
      @input="onInput"
      @keyup="updateState"
      @mouseup="updateState"
    />
  </div>
</template>

<style scoped>
[contenteditable] a { color: #3b82f6; text-decoration: underline; }
[contenteditable] ul { list-style: disc; padding-left: 1.25rem; }
[contenteditable] ol { list-style: decimal; padding-left: 1.25rem; }
[contenteditable]:empty::before {
  content: attr(data-placeholder);
  color: #9ca3af;
  pointer-events: none;
}
</style>
