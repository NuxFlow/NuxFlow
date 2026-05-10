<script setup lang="ts">
defineProps<{ data: { level?: number; text?: string; attrs?: Record<string, unknown> } }>()
</script>
<template>
  <component :is="`h${data.level ?? 2}`" class="font-bold leading-tight text-gray-900 dark:text-white" v-bind="data.attrs">
    {{ data.text }}
  </component>
</template>
