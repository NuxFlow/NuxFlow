<script setup lang="ts">
defineProps<{
  saving: boolean
  error: string
  lastSaved: Date | null
}>()
</script>

<template>
  <span class="text-sm text-gray-400">
    <span v-if="saving">Saving…</span>
    <span v-else-if="error" class="text-red-500">{{ error }}</span>
    <span v-else-if="lastSaved">Saved {{ lastSaved.toLocaleTimeString() }}</span>
    <span v-else class="text-gray-300">Unsaved</span>
  </span>
</template>
