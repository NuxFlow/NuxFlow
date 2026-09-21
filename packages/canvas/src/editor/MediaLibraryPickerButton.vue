<script setup lang="ts">
// Opens the host app's media library picker from inside a Canvas field editor. This
// package cannot statically import `EditorMediaPicker` — it lives in
// apps/nuxflow/app/components/editor/MediaPicker.vue, a different workspace package —
// so it's resolved by its Nuxt-auto-registered global name instead, the same
// `resolveComponent()`-by-string-name mechanism app/pages/admin/content/[id].vue already
// uses to mount CanvasContentEditor itself from this package. Falls back to a disabled
// hint (rather than throwing) when the host hasn't registered it — e.g. this package's
// own isolated tests/dev, which don't boot the full Nuxt app.
import { nextTick, onMounted, onUnmounted, ref, resolveComponent } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'

const emit = defineEmits<{
  select: [{ url: string; width?: number; height?: number; altText?: string }]
}>()

const open = ref(false)

const resolved = resolveComponent('EditorMediaPicker')
// Vue's resolveComponent() returns the bare string name back (not undefined/null) when
// nothing is registered under it — that's the "not available" signal here.
const pickerComponent = typeof resolved === 'string' ? null : resolved

// Same dialog semantics as AiGenerateModal.vue/BlockPicker.vue elsewhere in this package:
// Escape-to-close, initial focus, focus restore on close.
const dialogRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closePicker()
}

function openPicker() {
  previouslyFocused = document.activeElement as HTMLElement | null
  open.value = true
  nextTick(() => dialogRef.value?.focus())
}

function closePicker() {
  open.value = false
  previouslyFocused?.focus()
}

function onSelect(file: { url: string; width?: number | null; height?: number | null; altText?: string }) {
  emit('select', {
    url: file.url,
    width: file.width ?? undefined,
    height: file.height ?? undefined,
    altText: file.altText,
  })
  closePicker()
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <button
    type="button"
    class="px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors inline-flex items-center gap-1.5"
    @click="openPicker"
  >
    <UIcon name="i-lucide-image-plus" mode="svg" class="w-3.5 h-3.5" />
    Choose from library
  </button>

  <Teleport v-if="open" to="body">
    <div
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      aria-label="Choose from media library"
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      tabindex="-1"
      @click.self="closePicker"
    >
      <div class="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Choose from library</h3>
          <button
            type="button"
            class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            aria-label="Close"
            @click="closePicker"
          >
            <UIcon name="i-lucide-x" mode="svg" class="w-4 h-4 block" />
          </button>
        </div>
        <component :is="pickerComponent" v-if="pickerComponent" @select="onSelect" />
        <p v-else class="text-sm text-gray-400">Media library unavailable.</p>
      </div>
    </div>
  </Teleport>
</template>
