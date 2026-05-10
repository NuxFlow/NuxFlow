<script setup lang="ts">
const props = withDefaults(defineProps<{
  height?: number
  showLine?: boolean
}>(), {
  height: 48,
  showLine: false,
})
</script>

<template>
  <div :style="{ height: `${height}px` }" class="relative flex items-center">
    <div
      v-if="showLine"
      class="absolute inset-x-6 border-t border-gray-200 dark:border-gray-700"
    />
  </div>
</template>
