<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'
import { sanitizeRichText } from '../utils/sanitize-html'

const props = withDefaults(defineProps<{
  content?: string
  align?: 'left' | 'center' | 'right'
  padding?: SpacingValue
}>(), {
  content: '<p>Start writing your content here.</p>',
  align: 'left',
})

const containerStyle = computed(() => {
  const p = props.padding
  return p
    ? { padding: `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` }
    : { padding: '24px' }
})

// text-align on this wrapper (component-controlled, not sanitized content) is the supported
// way to center/right-align rich-text blocks — sanitizeRichText strips style/class from
// p/h1-h6 in the content itself as an XSS/CSS-injection guard, so alignment can't come from
// inline styles on those tags.
const alignClass = computed(() => ({
  'text-left': props.align === 'left',
  'text-center': props.align === 'center',
  'text-right': props.align === 'right',
}))

const safeContent = computed(() => sanitizeRichText(props.content))
</script>

<template>
  <div class="canvas-text" :style="containerStyle">
    <div
      class="prose prose-gray dark:prose-invert max-w-none"
      :class="alignClass"
      v-html="safeContent"
    />
  </div>
</template>
