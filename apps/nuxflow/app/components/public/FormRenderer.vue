<script setup lang="ts">
import type { FormField, ConditionalLogic } from '@nuxflow/db/schema'

const props = defineProps<{
  slug: string
  fields: FormField[]
  logic?: ConditionalLogic[]
}>()

const values = reactive<Record<string, unknown>>({})
const submitted = ref(false)
const error = ref('')
const submitting = ref(false)
const turnstileToken = ref('')

// Identifiers that must never appear in formulas regardless of field names,
// preventing prototype chain access, global leakage, or eval escapes.
const FORBIDDEN_IDENTIFIERS = new Set([
  'eval', 'Function', 'constructor', 'prototype', '__proto__',
  'this', 'arguments', 'global', 'globalThis', 'window', 'process',
  'import', 'require', 'fetch', 'XMLHttpRequest',
])

function safeEvaluateFormula(formula: string, fieldValues: Record<string, unknown>): unknown {
  const fieldNames = Object.keys(fieldValues)

  // Every identifier in the formula must be a known field name, not a forbidden global.
  const identifiers = formula.match(/[a-zA-Z_]\w*/g) ?? []
  for (const id of identifiers) {
    if (FORBIDDEN_IDENTIFIERS.has(id) || !fieldNames.includes(id)) return ''
  }

  // Allow only digits, whitespace, arithmetic operators, parentheses, and decimal points.
  // This blocks dots after identifiers (no property access), brackets, colons, etc.
  if (!/^[0-9a-zA-Z_\s+\-*/().]+$/.test(formula)) return ''

  // Expose only numeric conversions — no prototype chains reachable.
  const numericValues = Object.fromEntries(fieldNames.map(k => [k, Number(fieldValues[k]) || 0]))
  // eslint-disable-next-line no-new-func
  const fn = new Function(...Object.keys(numericValues), `"use strict"; return (${formula})`)
  return fn(...Object.values(numericValues))
}

function isFieldVisible(field: FormField): boolean {
  if (!props.logic?.length) return true
  const rules = props.logic.filter(l => l.fieldId === field.id)
  if (!rules.length) return true

  return rules.every(rule => {
    const condsMet = rule.conditions.every(c => {
      const val = values[c.fieldId]
      switch (c.operator) {
        case 'equals': return val === c.value
        case 'not_equals': return val !== c.value
        case 'contains': return String(val).includes(String(c.value))
        case 'greater_than': return Number(val) > Number(c.value)
        case 'less_than': return Number(val) < Number(c.value)
        default: return true
      }
    })
    return rule.action === 'show' ? condsMet : !condsMet
  })
}

function computeField(field: FormField): unknown {
  if (field.type !== 'computed' || !field.formula) return ''
  try {
    return safeEvaluateFormula(field.formula, values)
  } catch {
    return ''
  }
}

const visibleFields = computed(() => props.fields.filter(isFieldVisible))

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const result = await $fetch<{ success: boolean; redirectUrl?: string }>(
      `/api/v1/forms/${props.slug}/submit`,
      { method: 'POST', body: { turnstileToken: turnstileToken.value, data: values } },
    )
    if (result.redirectUrl) {
      await navigateTo(result.redirectUrl, { external: true })
    } else {
      submitted.value = true
    }
  } catch (e: unknown) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Submission failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto">
    <div v-if="submitted" class="text-center py-10 space-y-3">
      <UIcon name="i-lucide-check-circle" class="w-12 h-12 text-primary-500 mx-auto" />
      <p class="text-lg font-semibold">Thank you!</p>
      <p class="text-sm text-gray-500">Your response has been submitted.</p>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <template v-for="field in visibleFields" :key="field.id">
        <UFormField :label="field.label" :required="field.required">
          <template v-if="field.type === 'computed'">
            <UInput :model-value="String(computeField(field))" readonly />
          </template>
          <template v-else-if="field.type === 'textarea'">
            <UTextarea v-model="values[field.name] as string" :placeholder="field.placeholder" />
          </template>
          <template v-else-if="field.type === 'select'">
            <USelect :model-value="values[field.name] as string" :items="field.options ?? []" @update:model-value="values[field.name] = $event" />
          </template>
          <template v-else-if="field.type === 'checkbox'">
            <UCheckbox :model-value="Boolean(values[field.name])" :label="field.label" @update:model-value="values[field.name] = $event" />
          </template>
          <template v-else>
            <UInput v-model="values[field.name] as string" :type="field.type" :placeholder="field.placeholder" />
          </template>
        </UFormField>
      </template>

      <UAlert v-if="error" color="red" variant="soft" :description="error" />

      <UButton type="submit" :loading="submitting" block>Submit</UButton>
    </form>
  </div>
</template>
