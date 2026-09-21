<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SpacingValue } from '../types'
import NuxLightbox from './NuxLightbox.vue'
import NuxImage from './NuxImage.vue'
import { spacingToCss } from '../utils/spacing'
import { normalizeImageValue, type ImageFieldValue } from '../utils/json'

const props = withDefaults(defineProps<{
  // Accepts either shape: a bare URL string (every block prop stored before the media
  // picker carried real dimensions — see normalizeImageValue()) or {url,width,height}
  // (written by the picker from here on).
  src?: string | ImageFieldValue
  alt?: string
  caption?: string
  width?: 'full' | 'lg' | 'md' | 'sm'
  align?: 'left' | 'center' | 'right'
  rounded?: boolean
  focalX?: number
  focalY?: number
  lightbox?: boolean
  padding?: SpacingValue
}>(), {
  src: '',
  alt: '',
  caption: '',
  width: 'full',
  align: 'center',
  rounded: false,
  focalX: 50,
  focalY: 50,
  lightbox: false,
})

const widthClass = computed(() => ({
  full: 'w-full',
  lg: 'w-full max-w-5xl',
  md: 'w-full max-w-3xl',
  sm: 'w-full max-w-lg',
}[props.width ?? 'full']))

const wrapClass = computed(() => ({
  left: 'mr-auto',
  center: 'mx-auto',
  right: 'ml-auto',
}[props.align ?? 'center']))

const containerStyle = computed(() => ({ padding: spacingToCss(props.padding, '16px 24px') }))

const image = computed(() => normalizeImageValue(props.src))

const lightboxOpen = ref(false)

function handleClick() {
  if (props.lightbox && image.value.url) lightboxOpen.value = true
}
</script>

<template>
  <div class="canvas-image" :style="containerStyle">
    <figure :class="[widthClass, wrapClass]">
      <NuxImage
        v-if="image.url"
        :src="image.url"
        :alt="alt"
        :width="image.width"
        :height="image.height"
        class="w-full"
        :class="[{ 'rounded-xl': rounded }, lightbox ? 'cursor-zoom-in' : '']"
        :style="{ objectPosition: `${focalX}% ${focalY}%` }"
        @click="handleClick"
      />
      <div
        v-else
        class="w-full aspect-video bg-gray-100 dark:bg-gray-800 flex items-center justify-center rounded-lg"
        :class="{ 'rounded-xl': rounded }"
      >
        <span class="text-gray-400 text-sm">No image selected</span>
      </div>
      <figcaption v-if="caption" class="mt-2 text-sm text-gray-500 text-center">{{ caption }}</figcaption>
    </figure>

    <NuxLightbox
      v-if="lightboxOpen && image.url"
      :images="[{ url: image.url, alt }]"
      :initial-index="0"
      @close="lightboxOpen = false"
    />
  </div>
</template>
