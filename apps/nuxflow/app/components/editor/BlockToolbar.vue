<script setup lang="ts">
defineProps<{
  editor?: unknown
}>()
</script>

<template>
  <div class="flex items-center gap-1 flex-wrap p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-t-xl">
    <!-- Nuxt UI Pro UEditorToolbar handles the full TipTap toolbar -->
    <UEditorToolbar />
  </div>
</template>
