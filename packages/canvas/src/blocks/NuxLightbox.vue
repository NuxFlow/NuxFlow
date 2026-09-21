<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import NuxImage from './NuxImage.vue'

interface LightboxImage {
  url: string
  alt?: string
}

// Full-viewport display (max-w-[90vw] max-h-[90vh]) — capping the transform request
// width means a multi-megapixel original photo isn't served at full resolution just to
// be shown at, at most, a typical viewport's width.
const LIGHTBOX_MAX_WIDTH = 1920

const props = defineProps<{
  images: LightboxImage[]
  initialIndex?: number
}>()

const emit = defineEmits<{ close: [] }>()

const current = ref(props.initialIndex ?? 0)

function prev() {
  current.value = (current.value - 1 + props.images.length) % props.images.length
}

function next() {
  current.value = (current.value + 1) % props.images.length
}

// ── Dialog semantics: focus trap + focus restore ────────────────────────────
// The lightbox is toggled via `v-if` in CanvasBlockImage.vue/CanvasBlockGallery.vue,
// so mount/unmount here line up exactly with open/close — capturing the trigger
// element on mount and restoring it on unmount is sufficient, no separate
// close-transition to account for.

const containerRef = ref<HTMLElement | null>(null)
const closeBtnRef = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function getFocusable(): HTMLElement[] {
  if (!containerRef.value) return []
  return Array.from(containerRef.value.querySelectorAll<HTMLElement>('button'))
}

/** Cycles Tab/Shift+Tab between this dialog's own controls (close/prev/next)
 * instead of letting focus escape into the page behind it. */
function trapTab(e: KeyboardEvent) {
  const focusable = getFocusable()
  if (focusable.length === 0) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft') prev()
  if (e.key === 'ArrowRight') next()
  if (e.key === 'Tab') trapTab(e)
}

onMounted(() => {
  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', handleKey)
  document.body.style.overflow = 'hidden'
  closeBtnRef.value?.focus()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKey)
  document.body.style.overflow = ''
  previouslyFocused?.focus()
})
</script>

<template>
  <div
    ref="containerRef"
    role="dialog"
    aria-modal="true"
    aria-label="Image lightbox"
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/92"
    @click.self="$emit('close')"
  >
    <!-- Close -->
    <button
      ref="closeBtnRef"
      type="button"
      class="absolute top-4 right-4 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      aria-label="Close lightbox"
      @click="$emit('close')"
    >
      <UIcon name="i-lucide-x" mode="svg" class="w-7 h-7 block" />
    </button>

    <!-- Prev -->
    <button
      v-if="images.length > 1"
      type="button"
      class="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      aria-label="Previous image"
      @click="prev"
    >
      <UIcon name="i-lucide-chevron-left" mode="svg" class="w-8 h-8 block" />
    </button>

    <!-- Image -->
    <NuxImage
      :key="current"
      :src="images[current]?.url ?? ''"
      :alt="images[current]?.alt || ''"
      :width="LIGHTBOX_MAX_WIDTH"
      loading="eager"
      class="max-w-[90vw] max-h-[90vh] object-contain select-none drop-shadow-2xl"
    />

    <!-- Next -->
    <button
      v-if="images.length > 1"
      type="button"
      class="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      aria-label="Next image"
      @click="next"
    >
      <UIcon name="i-lucide-chevron-right" mode="svg" class="w-8 h-8 block" />
    </button>

    <!-- Counter -->
    <div v-if="images.length > 1" class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-sm select-none tabular-nums">
      {{ current + 1 }} / {{ images.length }}
    </div>
  </div>
</template>
