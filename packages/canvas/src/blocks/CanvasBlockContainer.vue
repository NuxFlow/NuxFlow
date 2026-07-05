<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  bgColor?: string
  maxWidth?: 'full' | 'lg' | 'md' | 'sm'
  padding?: SpacingValue
}>(), {
  maxWidth: 'full',
})

const maxWidthClass = computed(() => ({
  full: 'max-w-none',
  lg: 'max-w-5xl mx-auto',
  md: 'max-w-3xl mx-auto',
  sm: 'max-w-xl mx-auto',
}[props.maxWidth ?? 'full']))

const containerStyle = computed(() => {
  const p = props.padding
  const style: Record<string, string> = {}
  if (p) style.padding = `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}`
  if (props.bgColor) style.backgroundColor = props.bgColor
  return style
})
</script>

<template>
  <div class="canvas-container" :style="containerStyle">
    <div class="canvas-container__inner" :class="maxWidthClass">
      <slot name="default" />
    </div>
  </div>
</template>
