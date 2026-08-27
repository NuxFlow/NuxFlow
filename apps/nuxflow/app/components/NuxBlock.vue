<script setup lang="ts">
import { isCanvasContent } from '@nuxflow/canvas'
import { isBlocksContent } from '~/types/blocks'
import type { NuxBlockData } from '~/types/blocks'

const props = defineProps<{ content: unknown }>()

const isBlocks = computed(() => isBlocksContent(props.content))
const isCanvas = computed(() => isCanvasContent(props.content))

const html = computed(() =>
  isBlocks.value || isCanvas.value ? '' : renderTipTap(props.content),
)

const blocks = computed((): NuxBlockData[] => {
  if (isBlocksContent(props.content)) return props.content.blocks
  if (isCanvasContent(props.content)) return props.content.blocks
  return []
})
</script>

<template>
  <NuxBlocks v-if="isBlocks || isCanvas" :blocks="blocks" />
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-else class="nux-content" v-html="html" />
</template>
