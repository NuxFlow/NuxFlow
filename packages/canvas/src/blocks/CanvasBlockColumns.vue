<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  columns?: '2' | '3' | '4'
  gap?: number
  padding?: SpacingValue
}>(), {
  columns: '2',
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

// Reducing the column count only hides the extra slots — their block data is
// preserved in CanvasBlockData.children and reappears if the count goes back up.
const activeSlots = computed(() => {
  const count = parseInt(props.columns ?? '2', 10)
  return (['col1', 'col2', 'col3', 'col4'] as const).slice(0, count)
})
</script>

<template>
  <div class="canvas-columns" :style="containerStyle">
    <div class="grid" :class="gridClass" :style="gridStyle">
      <div v-for="slotName in activeSlots" :key="slotName" class="canvas-columns__col">
        <slot :name="slotName" />
      </div>
    </div>
  </div>
</template>
