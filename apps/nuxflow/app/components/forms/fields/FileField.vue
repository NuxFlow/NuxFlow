<script setup lang="ts">
defineProps<{ field: { label: string; required?: boolean; helpText?: string }; modelValue?: File | null }>()
const emit = defineEmits<{ 'update:modelValue': [v: File | null] }>()
function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null
  emit('update:modelValue', file)
}
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <input type="file" class="block w-full text-sm text-gray-500 file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" @change="onFile" >
  </UFormField>
</template>
