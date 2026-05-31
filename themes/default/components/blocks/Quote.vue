<script setup lang="ts">
defineProps<{ data: { text?: string; cite?: string } }>()
</script>
<template>
  <blockquote class="my-6 border-l-4 border-primary-400 pl-4">
    <p class="text-lg italic text-gray-700 dark:text-gray-300">{{ data.text }}</p>
    <cite v-if="data.cite" class="mt-2 block text-sm text-gray-400 not-italic">— {{ data.cite }}</cite>
  </blockquote>
</template>
