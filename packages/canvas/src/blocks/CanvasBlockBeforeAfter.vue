<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { normalizeImageValue } from '../utils/json'
import NuxImage from './NuxImage.vue'

// Theme hooks: .canvas-before-after, .canvas-before-after-frame, .canvas-before-after-handle,
// .canvas-before-after-label, .canvas-before-after-caption.
//
// The slider is a real <input type="range"> laid over the photos (invisible, full size), so
// dragging, tapping, the keyboard and screen readers all work with no pointer-event code.
// The "after" photo sets the size; the "before" photo is drawn over it and clipped.

const props = withDefaults(defineProps<{
  before?: unknown
  beforeAlt?: string
  beforeLabel?: string
  after?: unknown
  afterAlt?: string
  afterLabel?: string
  start?: number | string
  caption?: string
  rounded?: boolean
  bgColor?: string
  padding?: SpacingValue
}>(), {
  before: '',
  beforeAlt: '',
  beforeLabel: 'Before',
  after: '',
  afterAlt: '',
  afterLabel: 'After',
  start: 50,
  caption: '',
  rounded: true,
  bgColor: '',
  padding: undefined,
})

const beforeImage = computed(() => normalizeImageValue(props.before))
const afterImage = computed(() => normalizeImageValue(props.after))
const ready = computed(() => Boolean(beforeImage.value.url && afterImage.value.url))

function startValue(): number {
  const n = Number(props.start)
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50
}
const position = ref(startValue())
watch(() => props.start, () => { position.value = startValue() })

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section class="canvas-before-after" :style="containerStyle">
    <figure class="mx-auto max-w-4xl">
      <div
        v-if="ready"
        class="canvas-before-after-frame relative select-none overflow-hidden"
        :class="{ 'rounded-xl': rounded }"
      >
        <NuxImage :src="afterImage.url" :alt="afterAlt" :width="afterImage.width" :height="afterImage.height" class="block w-full" />
        <div class="absolute inset-0" :style="{ clipPath: `inset(0 ${100 - position}% 0 0)` }">
          <NuxImage :src="beforeImage.url" :alt="beforeAlt" :width="beforeImage.width" :height="beforeImage.height" fit="cover" class="h-full w-full object-cover" />
        </div>

        <span v-if="beforeLabel" class="canvas-before-after-label pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white">{{ beforeLabel }}</span>
        <span v-if="afterLabel" class="canvas-before-after-label pointer-events-none absolute right-3 top-3 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white">{{ afterLabel }}</span>

        <div class="canvas-before-after-handle pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" :style="{ left: `${position}%` }">
          <span class="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg>
          </span>
        </div>

        <input
          v-model.number="position"
          type="range"
          min="0"
          max="100"
          step="1"
          :aria-label="`Compare ${beforeLabel || 'before'} and ${afterLabel || 'after'}`"
          :aria-valuetext="`${position}% ${beforeLabel || 'before'}`"
          class="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        >
      </div>
      <div v-else class="flex aspect-video w-full items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400 dark:bg-gray-800">
        Choose a before and an after photo
      </div>
      <figcaption v-if="caption" class="canvas-before-after-caption mt-3 text-center text-sm opacity-75">{{ caption }}</figcaption>
    </figure>
  </section>
</template>
