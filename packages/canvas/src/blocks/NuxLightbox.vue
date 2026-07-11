<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'

interface LightboxImage {
  url: string
  alt?: string
}

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

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft') prev()
  if (e.key === 'ArrowRight') next()
}

onMounted(() => {
  document.addEventListener('keydown', handleKey)
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/92"
    @click.self="$emit('close')"
  >
    <!-- Close -->
    <button
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
    <img
      :key="current"
      :src="images[current]?.url"
      :alt="images[current]?.alt || ''"
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
