<script setup lang="ts">
import type { PublicSite } from '#shared/lib/public-site-types'
import { computed, ref, watch, watchEffect } from 'vue'
import { spacingToCss, type SpacingValue } from '@nuxflow/canvas'
import { formFilePartName } from '#shared/lib/form-files'
import { formSteps, hiddenFieldNames, isFilled } from '#shared/lib/form-logic'
import FormFieldList from './FormFieldList.vue'
import type { PublicFormField } from '#shared/lib/form-types'

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

const { data: formData, pending, error } = await useFetch<{ id: string; name: string; fields: PublicFormField[] }>(
  () => `/api/public/forms/${encodeURIComponent(props.formSlug)}`,
  {
    headers: useRequestHeaders(['host']),
    immediate: Boolean(props.formSlug),
    watch: [() => props.formSlug],
  },
)

const fields = computed(() => formData.value?.fields ?? [])

function defaultValueFor(field: PublicFormField): unknown {
  if (field.type === 'checkbox' || field.type === 'file') return []
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

// Keep 'computed' fields derived from their formula, same expression syntax and shared
// safe-math.ts evaluator as ComputedField.vue ({{fieldName}} substitution, then a
// restricted arithmetic parser — never Function()/eval on a string built from other
// fields' own values).
function evaluateFormula(expression: string | undefined, vals: Record<string, unknown>): string {
  if (!expression) return ''
  try {
    const expr = expression.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vals[key] ?? 0))
    return String(evaluateArithmeticExpression(expr))
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

const loading = ref(false)
const submitted = ref(false)

// ── Steps and conditional questions (shared/lib/form-logic.ts — the server applies the
// same rules on submit). A form with no Step fields is a single step.
const steps = computed(() => formSteps(fields.value))
const stepIndex = ref(0)
const stepError = ref('')
const hidden = computed(() => hiddenFieldNames(fields.value, values.value))
const isLastStep = computed(() => stepIndex.value >= steps.value.length - 1)
const currentStep = computed(() => steps.value[Math.min(stepIndex.value, Math.max(0, steps.value.length - 1))])
const visibleFields = computed(() => (currentStep.value?.fields ?? []).filter(f => !hidden.value.has(f.name)))
const formEl = ref<HTMLFormElement | null>(null)

/** The first required question on this step left unanswered, by label. */
function missingOnStep(): string | null {
  const field = visibleFields.value.find(f => f.required && f.type !== 'computed' && f.type !== 'hidden' && !isFilled(values.value[f.name]))
  return field ? field.label || field.name : null
}

function goTo(index: number) {
  stepIndex.value = Math.max(0, Math.min(index, steps.value.length - 1))
  stepError.value = ''
  formEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function next() {
  const missing = missingOnStep()
  if (missing) {
    stepError.value = `Please answer "${missing}" before going on.`
    return
  }
  goTo(stepIndex.value + 1)
}

const { data: _siteData } = useFetch<PublicSite>('/api/public/site', {
  key: 'nuxflow-turnstile-key',
  headers: useRequestHeaders(['host']),
})
const turnstileSiteKey = computed(() => _siteData.value?.turnstileSiteKey ?? '')
const hasTurnstile = computed(() => Boolean(turnstileSiteKey.value))
const turnstileToken = ref('')

const containerStyle = computed(() => {
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: spacingToCss(props.padding, '48px 24px'),
  }
})

function resetForm() {
  const next: Record<string, unknown> = {}
  for (const f of fields.value) next[f.name] = defaultValueFor(f)
  values.value = next
  turnstileToken.value = ''
  stepIndex.value = 0
  stepError.value = ''
}

async function submit() {
  if (!formData.value) return
  if (!isLastStep.value) return next()
  const missing = missingOnStep()
  if (missing) {
    stepError.value = `Please answer "${missing}".`
    return
  }
  loading.value = true
  try {
    // Files travel as multipart parts (`file:<field name>`) next to a `payload` part holding
    // the usual JSON body; the server keeps them in R2 (server/utils/form-files.ts). A form
    // with no files attached posts plain JSON as before.
    const data: Record<string, unknown> = {}
    const attached: Array<{ field: string; file: File }> = []
    for (const f of fields.value) {
      // Step headings have no answer; questions hidden by their condition send nothing.
      if (f.type === 'step' || hidden.value.has(f.name)) continue
      if (f.type === 'file') {
        for (const file of (values.value[f.name] as File[] | null) ?? []) attached.push({ field: f.name, file })
      } else {
        data[f.name] = values.value[f.name]
      }
    }
    const payload = { data, turnstileToken: turnstileToken.value || undefined }
    let body: FormData | typeof payload = payload
    if (attached.length) {
      const multipart = new FormData()
      multipart.append('payload', JSON.stringify(payload))
      for (const { field, file } of attached) multipart.append(formFilePartName(field), file, file.name)
      body = multipart
    }

    const url: string = `/api/v1/forms/${encodeURIComponent(props.formSlug)}/submit`
    await $fetch<unknown>(url, { method: 'POST', body })
    submitted.value = true
  } catch (e: unknown) {
    const msg = getErrorMessage(e, 'Could not submit the form. Please try again.')
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

      <form v-else ref="formEl" class="space-y-4 scroll-mt-24" @submit.prevent="submit">
        <div v-if="steps.length > 1" class="dynamic-form-progress space-y-2">
          <p class="text-sm font-medium opacity-80">
            Step {{ stepIndex + 1 }} of {{ steps.length }}<template v-if="currentStep?.title"> · {{ currentStep.title }}</template>
          </p>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="progressbar" :aria-valuenow="stepIndex + 1" aria-valuemin="1" :aria-valuemax="steps.length">
            <div class="h-full rounded-full bg-primary-500 transition-all" :style="{ width: `${((stepIndex + 1) / steps.length) * 100}%` }" />
          </div>
        </div>

        <FormFieldList :fields="visibleFields" :values="values" @update="(name, value) => { values[name] = value }" />

        <p v-if="stepError" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ stepError }}</p>

        <NuxtTurnstile v-if="hasTurnstile && isLastStep" v-model="turnstileToken" :site-key="turnstileSiteKey" />

        <div class="flex gap-3">
          <UButton v-if="stepIndex > 0" type="button" variant="outline" color="neutral" icon="i-lucide-arrow-left" @click="goTo(stepIndex - 1)">
            Back
          </UButton>
          <UButton type="submit" :loading="loading" class="flex-1 justify-center" :trailing-icon="isLastStep ? undefined : 'i-lucide-arrow-right'">
            {{ isLastStep ? submitLabel : 'Next' }}
          </UButton>
        </div>
      </form>
    </div>
  </section>
</template>
