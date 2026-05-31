<script setup lang="ts">
defineProps<{ field: { label: string; placeholder?: string; required?: boolean; helpText?: string }; modelValue?: number }>()
defineEmits<{ 'update:modelValue': [v: number] }>()
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <UInput type="number" :placeholder="field.placeholder" :model-value="modelValue" @update:model-value="$emit('update:modelValue', Number($event))" />
  </UFormField>
</template>
