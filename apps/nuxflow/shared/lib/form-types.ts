// A form's questions as visitors get them: publicFormField() and publicIntakeForm()
// (server/utils/form-submission.ts, booking-intake.ts). Rendered by FormFieldList.vue for
// Form blocks and for the intake form on event and appointment bookings. Import-free
// apart from other shared/lib types.
import type { ShowIf } from './form-logic'

export type FormFieldType = 'text' | 'email' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number' | 'date' | 'file' | 'computed' | 'hidden' | 'signature' | 'step'

/** One question. Never the admin-only parts of a field (validation rules). */
export interface PublicFormField {
  id: string
  type: FormFieldType
  label: string
  name: string
  placeholder?: string
  required?: boolean
  options?: { label: string; value: string }[]
  /** Only for `computed` fields, which work out their value in the browser. */
  formula?: string
  /** Show only when an earlier answer matches (shared/lib/form-logic.ts). */
  showIf?: ShowIf
}

/** The form a booking asks to be filled in first (a waiver, a questionnaire). */
export interface PublicIntakeForm {
  name: string
  fields: PublicFormField[]
}
