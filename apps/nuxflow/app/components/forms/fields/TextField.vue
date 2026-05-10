<script setup lang="ts">
defineProps<{ field: { label: string; placeholder?: string; required?: boolean; helpText?: string }; modelValue?: string }>()
defineEmits<{ 'update:modelValue': [v: string] }>()
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <UInput :placeholder="field.placeholder" :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" />
  </UFormField>
</template>
