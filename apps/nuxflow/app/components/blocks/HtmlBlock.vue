<script setup lang="ts">
import type { SpacingValue } from '@nuxflow/canvas'

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
  <!-- eslint-disable-next-line vue/no-v-html — admin-only canvas block; only editors can set this content -->
  <div :style="{ padding: paddingStyle }" v-html="html ?? ''" />
</template>
