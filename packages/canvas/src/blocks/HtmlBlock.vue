<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'
import { sanitizeCustomHtml } from '../utils/sanitize-html'
import { spacingToCss } from '../utils/spacing'

const props = defineProps<{
  html?: string
  padding?: SpacingValue
}>()

const paddingStyle = computed(() => spacingToCss(props.padding, '16px 16px 16px 16px'))

// Sanitized even though this block is meant for "raw" HTML — scripts and event handlers
// are never a legitimate use case here, and content is never validated on write (block
// `content` is stored as opaque JSON), so this is the only enforcement point.
const safeHtml = computed(() => sanitizeCustomHtml(props.html))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html — sanitized via sanitizeCustomHtml above -->
  <div :style="{ padding: paddingStyle }" v-html="safeHtml" />
</template>
