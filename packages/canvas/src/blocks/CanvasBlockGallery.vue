<script setup lang="ts">
import { computed, ref } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { SpacingValue } from '../types'
import NuxLightbox from './NuxLightbox.vue'
import { spacingToCss } from '../utils/spacing'
import { parseImageList, type ImageListItem } from '../utils/json'

const props = withDefaults(defineProps<{
  images?: string
  columns?: '2' | '3' | '4'
  gap?: number
  rounded?: boolean
  lightbox?: boolean
  padding?: SpacingValue
}>(), {
  images: '[]',
  columns: '3',
  gap: 8,
  rounded: false,
  lightbox: true,
})

const parsedImages = computed<ImageListItem[]>(() => parseImageList(props.images))

const gridCols = computed(() => ({
  '2': 'grid-cols-2',
  '3': 'grid-cols-2 sm:grid-cols-3',
  '4': 'grid-cols-2 sm:grid-cols-4',
}[props.columns ?? '3']))

const containerStyle = computed(() => ({ padding: spacingToCss(props.padding, '16px 24px') }))

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)

function openLightbox(i: number) {
  if (!props.lightbox) return
  lightboxIndex.value = i
  lightboxOpen.value = true
}
</script>

<template>
  <div class="canvas-gallery" :style="containerStyle">
    <div
      v-if="parsedImages.length"
      class="grid"
      :class="gridCols"
      :style="{ gap: `${gap}px` }"
    >
      <button
        v-for="(img, i) in parsedImages"
        :key="i"
        type="button"
        class="relative aspect-square overflow-hidden block w-full group"
        :class="[rounded ? 'rounded-lg' : '', lightbox ? 'cursor-zoom-in' : 'cursor-default']"
        @click="openLightbox(i)"
      >
        <img
          :src="img.url"
          :alt="img.alt || ''"
          class="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          loading="lazy"
        >
      </button>
    </div>

    <div
      v-else
      class="flex items-center justify-center h-40 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700"
    >
      <div class="text-center">
        <UIcon name="i-lucide-images" mode="svg" class="w-8 h-8 text-gray-300 mx-auto block mb-2" />
        <span class="text-sm text-gray-400">No images — edit this block to add photos</span>
      </div>
    </div>

    <NuxLightbox
      v-if="lightboxOpen"
      :images="parsedImages"
      :initial-index="lightboxIndex"
      @close="lightboxOpen = false"
    />
  </div>
</template>
