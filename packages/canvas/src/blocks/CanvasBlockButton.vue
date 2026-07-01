<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  label?: string
  url?: string
  align?: 'left' | 'center' | 'right'
  size?: 'sm' | 'md' | 'lg'
  rounded?: 'none' | 'md' | 'lg' | 'full'
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  label: 'Click here',
  url: '#',
  align: 'center',
  size: 'md',
  rounded: 'lg',
  bgColor: '#00dc82',
  textColor: '#0f172a',
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '16px 24px',
  }
})

const buttonStyle = computed(() => {
  return {
    backgroundColor: props.bgColor,
    color: props.textColor,
  }
})
</script>

<template>
  <div
    class="canvas-button w-full"
    :style="containerStyle"
  >
    <div
      class="flex"
      :class="{
        'justify-start': align === 'left',
        'justify-center': align === 'center',
        'justify-end': align === 'right',
      }"
    >
      <a
        :href="url"
        class="inline-flex items-center justify-center font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.98] shadow-sm"
        :style="buttonStyle"
        :class="[
          size === 'sm' ? 'px-4 py-2 text-sm' : '',
          size === 'md' ? 'px-6 py-3 text-base' : '',
          size === 'lg' ? 'px-8 py-4 text-lg' : '',
          rounded === 'none' ? 'rounded-none' : '',
          rounded === 'md' ? 'rounded-md' : '',
          rounded === 'lg' ? 'rounded-xl' : '',
          rounded === 'full' ? 'rounded-full' : '',
        ]"
      >
        {{ label }}
      </a>
    </div>
  </div>
</template>
