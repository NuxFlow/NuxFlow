<script setup lang="ts">
import { isBlocksContent } from '~/types/blocks'
import type { NuxBlockData } from '~/types/blocks'

const props = defineProps<{ content: unknown }>()

function isCanvasContent(val: unknown): val is { type: 'canvas'; blocks: NuxBlockData[] } {
  return (
    typeof val === 'object' &&
    val !== null &&
    (val as { type: string }).type === 'canvas' &&
    Array.isArray((val as { blocks: unknown[] }).blocks)
  )
}

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
  <div v-else class="nux-content" v-html="html" />
</template>
