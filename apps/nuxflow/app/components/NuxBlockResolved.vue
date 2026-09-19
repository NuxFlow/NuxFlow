<script setup lang="ts">
import { resolveDefinition } from '@nuxflow/canvas'
import type { NuxBlockData } from '~/types/blocks'

const props = defineProps<{ block: NuxBlockData }>()

const { resolve, getDefinition } = useBlockRegistry()

// Built-in canvas blocks carry their slot metadata in @nuxflow/canvas's own
// definitions; dynamic plugin blocks register it into the app-level registry
// instead — see resolveDefinition() in @nuxflow/canvas, shared with useCanvas.ts.
function slotsFor(type: string) {
  return resolveDefinition(type, { getDefinition })?.slots ?? []
}

function childrenFor(slotId: string): NuxBlockData[] {
  return props.block.children?.[slotId] ?? []
}
</script>

<template>
  <component
    :is="resolve(block.type)"
    v-if="resolve(block.type)"
    v-bind="block.props"
  >
    <template v-for="slot in slotsFor(block.type)" :key="slot.id" #[slot.id]>
      <NuxBlocks :blocks="childrenFor(slot.id)" />
    </template>
  </component>
</template>
