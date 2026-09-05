<script setup lang="ts">
// Renders no visible UI — a hidden field just carries a fixed value (its
// `placeholder` setting, used as the static default) through the form
// submission without prompting the visitor for input.
defineProps<{ field: { label: string; placeholder?: string }; modelValue?: string }>()
defineEmits<{ 'update:modelValue': [v: string] }>()
</script>
<template>
  <input type="hidden" :value="modelValue ?? field.placeholder ?? ''">
</template>
