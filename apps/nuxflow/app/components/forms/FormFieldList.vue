<script setup lang="ts">
import type { Component } from 'vue'
import type { ShowIf } from '#shared/lib/form-logic'
import TextField from './fields/TextField.vue'
import TextareaField from './fields/TextareaField.vue'
import EmailField from './fields/EmailField.vue'
import NumberField from './fields/NumberField.vue'
import SelectField from './fields/SelectField.vue'
import RadioField from './fields/RadioField.vue'
import CheckboxField from './fields/CheckboxField.vue'
import DateField from './fields/DateField.vue'
import FileField from './fields/FileField.vue'
import ComputedField from './fields/ComputedField.vue'
import SignatureField from './fields/SignatureField.vue'
import HiddenField from './fields/HiddenField.vue'

// Draws a Form Builder form's questions — for the Form block (DynamicFormBlock.vue) and the
// intake form in an event's booking box (EventRsvp.vue). The caller decides which fields to
// pass (one step's, the shown ones); a `step` field passed here is drawn as a heading.

export interface RenderableField {
  id: string
  type: string
  label: string
  name: string
  placeholder?: string
  required?: boolean
  options?: { label: string; value: string }[]
  formula?: string
  showIf?: ShowIf
}

defineProps<{
  fields: RenderableField[]
  values: Record<string, unknown>
}>()
const emit = defineEmits<{ update: [name: string, value: unknown] }>()

const FIELD_RENDERERS: Record<string, Component> = {
  text: TextField,
  textarea: TextareaField,
  email: EmailField,
  number: NumberField,
  select: SelectField,
  radio: RadioField,
  checkbox: CheckboxField,
  date: DateField,
  file: FileField,
  computed: ComputedField,
  signature: SignatureField,
  hidden: HiddenField,
}

// Only the props each field component declares — passing the raw field would leak `formula`
// etc. onto the DOM as fallthrough attributes.
function fieldProp(field: RenderableField) {
  return {
    label: field.label,
    placeholder: field.placeholder,
    required: field.required,
    options: field.options,
    expression: field.formula,
  }
}
</script>

<template>
  <template v-for="field in fields" :key="field.id">
    <p v-if="field.type === 'step'" class="pt-2 font-semibold">{{ field.label }}</p>
    <component
      :is="FIELD_RENDERERS[field.type]"
      v-else-if="FIELD_RENDERERS[field.type]"
      :field="fieldProp(field)"
      :model-value="values[field.name]"
      v-bind="field.type === 'computed' ? { formValues: values } : {}"
      @update:model-value="emit('update', field.name, $event)"
    />
  </template>
</template>
