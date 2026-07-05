<script setup lang="ts">
import { getBlockDefinition, type CanvasBlockDefinition } from '@nuxflow/canvas'
import type { NuxBlockData } from '~/types/blocks'

defineProps<{ blocks: NuxBlockData[] }>()

const { resolve, getDefinition } = useBlockRegistry()

// Built-in canvas blocks carry their slot metadata in @nuxflow/canvas's own
// definitions; dynamic plugin blocks register it into the app-level registry
// instead (mirrors the exact fallback used by useCanvas.ts / CanvasBlock.vue).
function slotsFor(type: string) {
  const def = getBlockDefinition(type) ?? (getDefinition(type) as CanvasBlockDefinition | undefined)
  return def?.slots ?? []
}

function childrenFor(block: NuxBlockData, slotId: string): NuxBlockData[] {
  return block.children?.[slotId] ?? []
}
</script>

<template>
  <div class="nux-blocks">
    <template v-for="block in blocks" :key="block.id">
      <!--
        Bundled blocks: resolve() returns a component on both server and client —
        rendered normally, fully SSR'd.

        Dynamic plugin blocks: resolve() returns undefined during SSR (plugins load
        client-side only). Wrapping in ClientOnly means the server emits the
        #fallback skeleton and the client takes over after dynamic plugins load,
        avoiding a hydration mismatch.
      -->
      <component
        :is="resolve(block.type)"
        v-if="resolve(block.type)"
        v-bind="block.props"
      >
        <template v-for="slot in slotsFor(block.type)" :key="slot.id" #[slot.id]>
          <NuxBlocks :blocks="childrenFor(block, slot.id)" />
        </template>
      </component>
      <ClientOnly v-else>
        <component
          :is="resolve(block.type)"
          v-if="resolve(block.type)"
          v-bind="block.props"
        >
          <template v-for="slot in slotsFor(block.type)" :key="slot.id" #[slot.id]>
            <NuxBlocks :blocks="childrenFor(block, slot.id)" />
          </template>
        </component>
        <template #fallback>
          <div class="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg h-16" />
        </template>
      </ClientOnly>
    </template>
  </div>
</template>
