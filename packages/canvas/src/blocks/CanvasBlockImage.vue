<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SpacingValue } from '../types'
import NuxLightbox from './NuxLightbox.vue'

const props = withDefaults(defineProps<{
  src?: string
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

const containerStyle = computed(() => {
  const p = props.padding
  return p
    ? { padding: `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` }
    : { padding: '16px 24px' }
})

const lightboxOpen = ref(false)

function handleClick() {
  if (props.lightbox && props.src) lightboxOpen.value = true
}
</script>

<template>
  <div class="canvas-image" :style="containerStyle">
    <figure :class="[widthClass, wrapClass]">
      <img
        v-if="src"
        :src="src"
        :alt="alt"
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
      v-if="lightboxOpen && src"
      :images="[{ url: src, alt }]"
      :initial-index="0"
      @close="lightboxOpen = false"
    />
  </div>
</template>
