<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  columns?: '2' | '3' | '4'
  col1?: string
  col2?: string
  col3?: string
  col4?: string
  gap?: number
  padding?: SpacingValue
}>(), {
  columns: '2',
  col1: '<p>Column one content.</p>',
  col2: '<p>Column two content.</p>',
  col3: '',
  col4: '',
  gap: 24,
})

const gridClass = computed(() => ({
  '2': 'grid-cols-1 md:grid-cols-2',
  '3': 'grid-cols-1 md:grid-cols-3',
  '4': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}[props.columns ?? '2']))

const containerStyle = computed(() => {
  const p = props.padding
  return p
    ? { padding: `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` }
    : { padding: '24px' }
})

const gridStyle = computed(() => ({
  gap: `${props.gap ?? 24}px`,
}))

const colContents = computed(() => {
  const count = parseInt(props.columns ?? '2')
  return [props.col1, props.col2, props.col3, props.col4].slice(0, count)
})
</script>

<template>
  <div class="canvas-columns" :style="containerStyle">
    <div class="grid" :class="gridClass" :style="gridStyle">
      <div
        v-for="(col, i) in colContents"
        :key="i"
        class="prose prose-gray dark:prose-invert max-w-none"
        v-html="col"
      />
    </div>
  </div>
</template>
