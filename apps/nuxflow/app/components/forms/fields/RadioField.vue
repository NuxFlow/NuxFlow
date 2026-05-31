<script setup lang="ts">
defineProps<{
  field: { label: string; required?: boolean; helpText?: string; options?: { label: string; value: string }[] }
  modelValue?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <div class="space-y-2">
      <label v-for="opt in field.options ?? []" :key="opt.value" class="flex items-center gap-2 cursor-pointer">
        <input type="radio" :value="opt.value" :checked="modelValue === opt.value" class="accent-primary-500" @change="emit('update:modelValue', opt.value)" >
        <span class="text-sm">{{ opt.label }}</span>
      </label>
    </div>
  </UFormField>
</template>
