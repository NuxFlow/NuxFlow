<script setup lang="ts">
import type { NuxBlockData } from '~/types/blocks'

defineProps<{ blocks: NuxBlockData[] }>()

const { resolve } = useBlockRegistry()
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
        v-if="resolve(block.type)"
        :is="resolve(block.type)"
        v-bind="block.props"
      />
      <ClientOnly v-else>
        <component
          v-if="resolve(block.type)"
          :is="resolve(block.type)"
          v-bind="block.props"
        />
        <template #fallback>
          <div class="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg h-16" />
        </template>
      </ClientOnly>
    </template>
  </div>
</template>
