<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import type { Component } from 'vue'
import type { SpacingValue } from '@nuxflow/canvas'
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

interface RenderableField {
  id: string
  type: string
  label: string
  name: string
  placeholder?: string
  required?: boolean
  options?: { label: string; value: string }[]
  formula?: string
}

// Mirrors apps/nuxflow/app/components/forms/fields/index.ts's FIELD_COMPONENTS
// map, but as actual component references — this file lives in the app
// package (same boundary as ContactFormBlock.vue/MembershipsBlock.vue), so it
// can import the field renderers directly rather than resolving them by
// auto-import name.
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

const toast = useToast()

const props = withDefaults(defineProps<{
  formSlug?: string
  title?: string
  description?: string
  submitLabel?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  formSlug: '',
  title: '',
  description: '',
  submitLabel: 'Submit',
  bgColor: undefined,
  textColor: undefined,
  padding: undefined,
})

const { data: formData, pending, error } = await useFetch<{ id: string; name: string; fields: RenderableField[] }>(
  () => `/api/public/forms/${encodeURIComponent(props.formSlug)}`,
  {
    headers: useRequestHeaders(['host']),
    immediate: Boolean(props.formSlug),
    watch: [() => props.formSlug],
  },
)

const fields = computed(() => formData.value?.fields ?? [])

function defaultValueFor(field: RenderableField): unknown {
  if (field.type === 'checkbox') return []
  if (field.type === 'hidden') return field.placeholder ?? ''
  return ''
}

const values = ref<Record<string, unknown>>({})

// Seed (and re-seed on form change) so every declared field has a bound value
// before render — components rely on modelValue being defined rather than undefined.
watch(fields, (list) => {
  const next: Record<string, unknown> = {}
  for (const f of list) {
    next[f.name] = defaultValueFor(f)
  }
  values.value = next
}, { immediate: true })

// Keep 'computed' fields derived from their formula, same expression syntax
// as FormsFieldsComputedField.vue ({{fieldName}} substitution + eval).
function evaluateFormula(expression: string | undefined, vals: Record<string, unknown>): string {
  if (!expression) return ''
  try {
    const expr = expression.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vals[key] ?? 0))
    return String(Function(`'use strict'; return (${expr})`)())
  } catch {
    return 'Invalid expression'
  }
}

watchEffect(() => {
  for (const f of fields.value) {
    if (f.type === 'computed') {
      values.value[f.name] = evaluateFormula(f.formula, values.value)
    }
  }
})

// Only the subset of RenderableField each field component actually declares
// in its own props — passing the raw field through would leak `formula` etc.
// onto the DOM as fallthrough attributes.
function fieldProp(field: RenderableField) {
  return {
    label: field.label,
    placeholder: field.placeholder,
    required: field.required,
    options: field.options,
    expression: field.formula,
  }
}

const loading = ref(false)
const submitted = ref(false)

const { data: _siteData } = useFetch('/api/public/site', {
  key: 'nuxflow-turnstile-key',
  headers: useRequestHeaders(['host']),
})
const turnstileSiteKey = computed(() => (_siteData.value as { turnstileSiteKey?: string | null } | null)?.turnstileSiteKey ?? '')
const hasTurnstile = computed(() => Boolean(turnstileSiteKey.value))
const turnstileToken = ref('')

const containerStyle = computed(() => {
  const p = props.padding
  const paddingVal = p
    ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}`
    : '48px 24px'
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: paddingVal,
  }
})

function resetForm() {
  const next: Record<string, unknown> = {}
  for (const f of fields.value) next[f.name] = defaultValueFor(f)
  values.value = next
  turnstileToken.value = ''
}

async function submit() {
  if (!formData.value) return
  loading.value = true
  try {
    // File inputs can't travel as JSON — form_submissions.data is a plain JSON
    // column with no binary storage, and wiring a real upload would go through
    // the media provider system (out of scope here), so only the file's name
    // is recorded, same as every other primitive field value.
    const data: Record<string, unknown> = {}
    for (const f of fields.value) {
      if (f.type === 'file') {
        const file = values.value[f.name] as File | null
        data[f.name] = file ? file.name : ''
      } else {
        data[f.name] = values.value[f.name]
      }
    }

    await $fetch(`/api/v1/forms/${encodeURIComponent(props.formSlug)}/submit`, {
      method: 'POST',
      body: {
        data,
        turnstileToken: turnstileToken.value || undefined,
      },
    })
    submitted.value = true
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Could not submit the form. Please try again.'
    toast.add({ title: msg, color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="dynamic-form-block w-full" :style="containerStyle">
    <div class="max-w-lg mx-auto">
      <div v-if="title || description" class="text-center mb-8 space-y-2">
        <h2 v-if="title" class="text-3xl font-extrabold tracking-tight">{{ title }}</h2>
        <p v-if="description" class="text-base opacity-85 whitespace-pre-wrap">{{ description }}</p>
      </div>

      <div v-if="!formSlug" class="text-center py-12 text-sm opacity-60">
        No form selected. Set a form slug in the block settings.
      </div>

      <div v-else-if="pending" class="text-center py-12 text-sm opacity-60">
        Loading form…
      </div>

      <div v-else-if="error || !formData" class="text-center py-12 text-sm opacity-60">
        This form is not available.
      </div>

      <div v-else-if="submitted" class="text-center py-12 space-y-3">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30">
          <UIcon name="i-lucide-check" class="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>
        <p class="font-semibold text-gray-900 dark:text-white">Thank you!</p>
        <p class="text-sm text-gray-500">Your submission has been received.</p>
        <UButton variant="ghost" size="sm" @click="submitted = false; resetForm()">
          Submit another response
        </UButton>
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <component
          :is="FIELD_RENDERERS[field.type]"
          v-for="field in fields"
          :key="field.id"
          :field="fieldProp(field)"
          :model-value="values[field.name]"
          v-bind="field.type === 'computed' ? { formValues: values } : {}"
          @update:model-value="values[field.name] = $event"
        />

        <NuxtTurnstile v-if="hasTurnstile" v-model="turnstileToken" :site-key="turnstileSiteKey" />

        <UButton type="submit" :loading="loading" block>
          {{ submitLabel }}
        </UButton>
      </form>
    </div>
  </section>
</template>
