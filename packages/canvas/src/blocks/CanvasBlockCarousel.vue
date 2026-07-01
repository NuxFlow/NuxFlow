<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SpacingValue } from '../types'

interface SlideImage {
  url: string
  alt?: string
}

const props = withDefaults(defineProps<{
  images?: string
  aspectRatio?: '16:9' | '21:9' | '4:3' | '1:1'
  autoplay?: boolean
  interval?: number
  loop?: boolean
  arrows?: boolean
  dots?: boolean
  rounded?: boolean
  padding?: SpacingValue
}>(), {
  images: '[]',
  aspectRatio: '16:9',
  autoplay: true,
  interval: 5000,
  loop: true,
  arrows: true,
  dots: true,
  rounded: false,
})

const parsedImages = computed<SlideImage[]>(() => {
  try {
    const arr = JSON.parse(props.images || '[]')
    return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === 'object' && x !== null && typeof (x as SlideImage).url === 'string') : []
  }
  catch {
    return []
  }
})

const current = ref(0)

watch(parsedImages, (images) => {
  if (current.value >= images.length) current.value = 0
})

function goTo(index: number) {
  const len = parsedImages.value.length
  if (!len) return
  current.value = ((index % len) + len) % len
}

function next() {
  if (!props.loop && current.value === parsedImages.value.length - 1) return
  goTo(current.value + 1)
}

function prev() {
  if (!props.loop && current.value === 0) return
  goTo(current.value - 1)
}

// ── Autoplay — paused on hover, restarted whenever config or slide count changes ──
let timer: ReturnType<typeof setInterval> | undefined

function stopAutoplay() {
  if (timer) clearInterval(timer)
  timer = undefined
}

function startAutoplay() {
  stopAutoplay()
  if (!props.autoplay || parsedImages.value.length < 2) return
  timer = setInterval(next, Math.max(props.interval ?? 5000, 1000))
}

onMounted(startAutoplay)
onUnmounted(stopAutoplay)
watch(() => [props.autoplay, props.interval, parsedImages.value.length], startAutoplay)

// ── Touch swipe ───────────────────────────────────────────────────────────
let touchStartX = 0

function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0]?.clientX ?? 0
}

function onTouchEnd(e: TouchEvent) {
  const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX
  if (Math.abs(dx) > 50) {
    dx > 0 ? prev() : next()
  }
}

// Only acts while the carousel itself is focused, so it doesn't hijack page-level arrow keys.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') prev()
  if (e.key === 'ArrowRight') next()
}

const aspectClass = computed(() => ({
  '16:9': 'aspect-[16/9]',
  '21:9': 'aspect-[21/9]',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
}[props.aspectRatio ?? '16:9']))

const containerStyle = computed(() => {
  const p = props.padding
  return p
    ? { padding: `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` }
    : undefined
})
</script>

<template>
  <div class="canvas-carousel" :style="containerStyle">
    <div
      v-if="parsedImages.length"
      class="relative w-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      :class="[aspectClass, rounded ? 'rounded-xl' : '']"
      role="region"
      aria-roledescription="carousel"
      aria-label="Image carousel"
      tabindex="0"
      @mouseenter="stopAutoplay"
      @mouseleave="startAutoplay"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @keydown="onKeydown"
    >
      <div
        class="flex h-full w-full transition-transform duration-500 ease-out"
        :style="{ transform: `translateX(-${current * 100}%)` }"
      >
        <div
          v-for="(img, i) in parsedImages"
          :key="i"
          class="h-full w-full shrink-0"
          :aria-hidden="i !== current"
        >
          <img
            :src="img.url"
            :alt="img.alt || ''"
            class="h-full w-full object-cover"
            :loading="i === 0 ? 'eager' : 'lazy'"
          />
        </div>
      </div>

      <template v-if="arrows && parsedImages.length > 1">
        <button
          type="button"
          class="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          aria-label="Previous slide"
          @click="prev"
        >
          <span class="i-lucide-chevron-left w-5 h-5" />
        </button>
        <button
          type="button"
          class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          aria-label="Next slide"
          @click="next"
        >
          <span class="i-lucide-chevron-right w-5 h-5" />
        </button>
      </template>

      <div
        v-if="dots && parsedImages.length > 1"
        class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2"
      >
        <button
          v-for="(_, i) in parsedImages"
          :key="i"
          type="button"
          class="h-2 rounded-full transition-all"
          :class="i === current ? 'w-5 bg-white' : 'w-2 bg-white/50'"
          :aria-label="`Go to slide ${i + 1}`"
          :aria-current="i === current"
          @click="goTo(i)"
        />
      </div>
    </div>

    <div
      v-else
      class="flex items-center justify-center h-40 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700"
    >
      <div class="text-center">
        <span class="i-lucide-gallery-horizontal w-8 h-8 text-gray-300 mx-auto block mb-2" />
        <span class="text-sm text-gray-400">No images — edit this block to add slides</span>
      </div>
    </div>
  </div>
</template>
