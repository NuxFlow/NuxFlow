<script setup lang="ts">
defineProps<{ data: { code?: string; language?: string } }>()
</script>
<template>
  <div class="my-4 rounded-xl overflow-hidden bg-gray-900 dark:bg-gray-950">
    <div v-if="data.language" class="px-4 py-2 text-xs text-gray-400 border-b border-gray-700 font-mono">
      {{ data.language }}
    </div>
    <pre class="p-4 text-sm font-mono text-gray-100 overflow-x-auto"><code>{{ data.code }}</code></pre>
  </div>
</template>
