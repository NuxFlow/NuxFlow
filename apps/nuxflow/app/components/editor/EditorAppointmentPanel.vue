<script setup lang="ts">
import type { AdminFormsResponse } from '#shared/lib/form-types'
// Shown for a page with a Book an Appointment block: the form people fill in when booking
// (a waiver or questionnaire — server/utils/booking-intake.ts, kept in the item's settings as
// `intakeFormId`, the same setting events use), and where the bookings are.
const intakeFormId = defineModel<string>('intakeFormId', { required: true })
defineProps<{ disabled?: boolean }>()

// The select can't hold an empty value, so "none" stands in for no form.
const NO_FORM = 'none'
const choice = computed({
  get: () => intakeFormId.value || NO_FORM,
  set: (v: string) => { intakeFormId.value = v === NO_FORM ? '' : v },
})
const formOptions = ref<Array<{ label: string; value: string }>>([])
onMounted(async () => {
  try {
    const res = await $fetch<AdminFormsResponse>('/api/v1/forms')
    formOptions.value = [{ label: 'None', value: NO_FORM }, ...res.forms.filter(f => f.status === 'active').map(f => ({ label: f.name, value: f.id }))]
  }
  catch {
    // Listing forms needs the editor role; an author just doesn't get the choice.
    formOptions.value = []
  }
})
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Appointments</p>
    <p class="text-xs text-gray-500">
      Length, price and notice are in the block's settings; your hours are in
      <NuxtLink to="/admin/settings" class="underline">Settings → Appointments</NuxtLink>.
    </p>
    <UFormField
      v-if="formOptions.length > 1"
      label="Form to fill in when booking"
      hint="Optional"
      description="A waiver or questionnaire people must answer before their booking goes through. Answers go to that form's Submissions."
      class="text-xs"
    >
      <USelect v-model="choice" :items="formOptions" :disabled="disabled" class="w-full text-sm" />
    </UFormField>
    <UButton to="/admin/appointments" size="xs" variant="outline" icon="i-lucide-calendar-clock">See appointments</UButton>
  </div>
</template>
