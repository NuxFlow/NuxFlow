<script setup lang="ts">
import type { NuxBlockData } from '~/types/blocks'

defineProps<{ blocks: NuxBlockData[] }>()

const { resolve } = useBlockRegistry()
</script>

<template>
  <div class="nux-blocks">
    <template v-for="block in blocks" :key="block.id">
      <component
        :is="resolve(block.type)"
        v-if="resolve(block.type)"
        v-bind="block.props"
      />
      <!-- Placeholder shown while dynamic plugin blocks are still loading -->
      <div
        v-else
        class="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg h-16"
      />
    </template>
  </div>
</template>
