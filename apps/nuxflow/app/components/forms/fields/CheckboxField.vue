<script setup lang="ts">
defineProps<{
  field: { label: string; required?: boolean; helpText?: string; options?: { label: string; value: string }[] }
  modelValue?: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()
function toggle(val: string, current: string[]) {
  const s = new Set(current)
  if (s.has(val)) { s.delete(val) } else { s.add(val) }
  emit('update:modelValue', [...s])
}
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <div class="space-y-2">
      <label v-for="opt in field.options ?? []" :key="opt.value" class="flex items-center gap-2 cursor-pointer">
        <UCheckbox :checked="(modelValue ?? []).includes(opt.value)" @update:checked="toggle(opt.value, modelValue ?? [])" />
        <span class="text-sm">{{ opt.label }}</span>
      </label>
    </div>
  </UFormField>
</template>
