<script setup lang="ts">
import { isCanvasContent } from '@nuxflow/canvas'
import { renderTipTap } from '#shared/lib/render-tiptap'

// Stored content is either a Canvas document or TipTap JSON.
const props = defineProps<{ content: unknown }>()

const canvas = computed(() => isCanvasContent(props.content) ? props.content : null)
const html = computed(() => canvas.value ? '' : renderTipTap(props.content))
</script>

<template>
  <NuxBlocks v-if="canvas" :blocks="canvas.blocks" />
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else class="nux-content" v-html="html" />
</template>
