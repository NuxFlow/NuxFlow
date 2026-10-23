<script setup lang="ts">
// Opens the host app's media library picker from inside a Canvas field editor. This
// package cannot import `EditorMediaPicker` (it lives in apps/nuxflow), so the app hands
// it over as `mediaPicker` on the CanvasHost (host.ts). Falls back to a disabled hint
// (rather than throwing) when the host provides none.
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { PickedMedia } from '../utils/gallery'
import { useCanvasHost } from '../host'

// `multiple` puts the picker in multi-select mode (Gallery/Carousel image lists) and
// emits `selectMany` once with every chosen file; otherwise `select` with one file.
const props = withDefaults(defineProps<{ multiple?: boolean; label?: string }>(), {
  multiple: false,
  label: 'Choose from library',
})

const emit = defineEmits<{
  select: [PickedMedia]
  selectMany: [PickedMedia[]]
}>()

const open = ref(false)

// The app's media library dialog — absent where the app provides none.
const pickerComponent = useCanvasHost().mediaPicker ?? null

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

interface RawPicked { url: string; width?: number | null; height?: number | null; altText?: string | null; caption?: string | null }

function toPicked(file: RawPicked): PickedMedia {
  return {
    url: file.url,
    width: file.width ?? undefined,
    height: file.height ?? undefined,
    altText: file.altText ?? undefined,
    caption: file.caption ?? undefined,
  }
}

function onSelect(file: RawPicked) {
  emit('select', toPicked(file))
  closePicker()
}

function onSelectMany(files: RawPicked[]) {
  emit('selectMany', files.map(toPicked))
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
    {{ props.label }}
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
      <div class="w-full max-w-3xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ props.multiple ? 'Add images from library' : 'Choose from library' }}</h3>
          <button
            type="button"
            class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            aria-label="Close"
            @click="closePicker"
          >
            <UIcon name="i-lucide-x" mode="svg" class="w-4 h-4 block" />
          </button>
        </div>
        <component
          :is="pickerComponent"
          v-if="pickerComponent"
          :multiple="props.multiple"
          @select="onSelect"
          @select-many="onSelectMany"
        />
        <p v-else class="text-sm text-gray-400">Media library unavailable.</p>
      </div>
    </div>
  </Teleport>
</template>
