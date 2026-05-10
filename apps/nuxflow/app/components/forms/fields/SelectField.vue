<script setup lang="ts">
defineProps<{
  field: { label: string; required?: boolean; helpText?: string; options?: { label: string; value: string }[] }
  modelValue?: string
}>()
defineEmits<{ 'update:modelValue': [v: string] }>()
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <USelect :items="field.options ?? []" :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event as string)" />
  </UFormField>
</template>
