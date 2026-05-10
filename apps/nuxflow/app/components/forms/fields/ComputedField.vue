<script setup lang="ts">
const props = defineProps<{
  field: { label: string; helpText?: string; expression?: string }
  formValues?: Record<string, unknown>
}>()

const result = computed(() => {
  if (!props.field.expression) return ''
  try {
    const expr = props.field.expression.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(props.formValues?.[key] ?? 0)
    })
    return Function(`'use strict'; return (${expr})`)()
  } catch {
    return 'Invalid expression'
  }
})
</script>
<template>
  <UFormField :label="field.label" :hint="field.helpText">
    <div class="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm font-mono text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
      {{ result }}
    </div>
  </UFormField>
</template>
