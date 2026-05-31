<script setup lang="ts">
defineProps<{ data: { html?: string; text?: string } }>()
</script>
<template>
  <p class="text-gray-700 dark:text-gray-300 leading-relaxed" v-html="data.html ?? data.text" />
</template>
