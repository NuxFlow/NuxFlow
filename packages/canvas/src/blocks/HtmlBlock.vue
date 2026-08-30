<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'
import { sanitizeCustomHtml } from '../utils/sanitize-html'

const props = defineProps<{
  html?: string
  padding?: SpacingValue
}>()

const paddingStyle = computed(() => {
  const p = props.padding ?? { top: 16, right: 16, bottom: 16, left: 16, unit: 'px' }
  return `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}`
})

// Sanitized even though this block is meant for "raw" HTML — scripts and event handlers
// are never a legitimate use case here, and content is never validated on write (block
// `content` is stored as opaque JSON), so this is the only enforcement point.
const safeHtml = computed(() => sanitizeCustomHtml(props.html))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html — sanitized via sanitizeCustomHtml above -->
  <div :style="{ padding: paddingStyle }" v-html="safeHtml" />
</template>
