<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'
import { sanitizeRichText } from '../utils/sanitize-html'

const props = withDefaults(defineProps<{
  content?: string
  padding?: SpacingValue
}>(), {
  content: '<p>Start writing your content here.</p>',
})

const containerStyle = computed(() => {
  const p = props.padding
  return p
    ? { padding: `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` }
    : { padding: '24px' }
})

const safeContent = computed(() => sanitizeRichText(props.content))
</script>

<template>
  <div class="canvas-text" :style="containerStyle">
    <div
      class="prose prose-gray dark:prose-invert max-w-none"
      v-html="safeContent"
    />
  </div>
</template>
