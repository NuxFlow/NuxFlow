<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  caption?: string
  width?: 'full' | 'lg' | 'md' | 'sm'
  align?: 'left' | 'center' | 'right'
  rounded?: boolean
  padding?: SpacingValue
}>(), {
  src: '',
  alt: '',
  caption: '',
  width: 'full',
  align: 'center',
  rounded: false,
})

const widthClass = computed(() => ({
  full: 'w-full',
  lg: 'w-3/4',
  md: 'w-1/2',
  sm: 'w-1/3',
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
</script>

<template>
  <div :style="containerStyle">
    <figure :class="[widthClass, wrapClass]">
      <img
        v-if="src"
        :src="src"
        :alt="alt"
        class="w-full"
        :class="{ 'rounded-xl': rounded }"
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
  </div>
</template>
