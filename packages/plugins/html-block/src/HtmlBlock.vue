<script setup lang="ts">
import type { SpacingValue } from '@nuxflow/plugin-canvas'

const props = defineProps<{
  html?: string
  padding?: SpacingValue
}>()

const paddingStyle = computed(() => {
  const p = props.padding ?? { top: 16, right: 16, bottom: 16, left: 16, unit: 'px' }
  return `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}`
})
</script>

<template>
  <div :style="{ padding: paddingStyle }" v-html="html ?? ''" />
</template>
