<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { parseImageList } from '../utils/json'
import NuxImage from './NuxImage.vue'

// Theme hooks: .canvas-logos, .canvas-logos-list, .canvas-logos-item.

const props = withDefaults(defineProps<{
  title?: string
  images?: string
  logoHeight?: number | string
  grayscale?: boolean
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Trusted by',
  images: '[]',
  logoHeight: 48,
  grayscale: true,
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const logos = computed(() => parseImageList(props.images))
const height = computed(() => {
  const n = Number(props.logoHeight)
  return Number.isFinite(n) ? Math.min(160, Math.max(16, n)) : 48
})
/** Width to reserve for a logo at the chosen height, from its real proportions when known. */
function widthFor(logo: { width?: number; height?: number }): number | undefined {
  return logo.width && logo.height ? Math.round(logo.width * height.value / logo.height) : undefined
}

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '40px 24px'),
}))
</script>

<template>
  <section class="canvas-logos" :style="containerStyle">
    <div class="mx-auto max-w-6xl text-center">
      <p v-if="title" class="mb-6 text-sm font-semibold uppercase tracking-wider opacity-70">{{ title }}</p>
      <ul v-if="logos.length" class="canvas-logos-list flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        <li v-for="(logo, i) in logos" :key="`${logo.url}-${i}`" class="canvas-logos-item">
          <NuxImage
            :src="logo.url"
            :alt="logo.alt || ''"
            :width="widthFor(logo)"
            :height="height"
            fit="contain"
            class="w-auto object-contain transition duration-200"
            :class="grayscale ? 'grayscale opacity-70 hover:grayscale-0 hover:opacity-100' : ''"
            :style="{ height: `${height}px` }"
          />
        </li>
      </ul>
      <p v-else class="text-sm opacity-60">Add logos in the block settings.</p>
    </div>
  </section>
</template>
