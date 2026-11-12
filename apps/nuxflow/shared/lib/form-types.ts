// Forms as visitors and staff get them. Visitors: publicFormField() and publicIntakeForm()
// (server/utils/form-submission.ts, booking-intake.ts), rendered by FormFieldList.vue for
// Form blocks and for the intake form on event and appointment bookings. Staff: the
// /api/v1/forms routes (Admin → Forms, the form builder, the submissions inbox and the
// editor's intake-form pickers). Import-free apart from other shared/lib types.
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

// ── Staff (Admin → Forms)

export type FormStatus = 'active' | 'draft' | 'closed'

/** One row of GET /api/v1/forms. Counts leave spam out. */
export interface AdminFormSummary {
  id: string
  name: string
  slug: string
  status: FormStatus
  createdAt: string
  updatedAt: string
  submissionCount: number
  /** Not yet opened. */
  newCount: number
}

export interface AdminFormsResponse {
  forms: AdminFormSummary[]
}

/** A field as the form builder edits it: everything stored in `forms.fields` (the
 * `FormField` type in packages/db/src/schema/forms.ts, which the server is checked against). */
export interface AdminFormField extends Omit<PublicFormField, 'showIf'> {
  validation?: Record<string, unknown>
  showIf?: ShowIf | null
}

/** Who hears about a new submission. No `email` = the site's admin address. */
export interface FormNotifications {
  enabled?: boolean
  email?: string
}

/** GET /api/v1/forms/:id: the form as the builder opens it. */
export interface AdminForm {
  id: string
  name: string
  slug: string
  status: FormStatus
  fields: AdminFormField[]
  notifications: FormNotifications | null
}

export type FormSubmissionStatus = 'new' | 'read' | 'spam' | 'archived'

export interface AdminFormSubmission {
  id: string
  createdAt: string
  status: FormSubmissionStatus
  /** Answers keyed by field name. A file field holds StoredFormFile[] (form-files.ts). */
  data: Record<string, unknown>
}

/** GET /api/v1/forms/:id/submissions: one page of a form's inbox. */
export interface FormSubmissionsResponse {
  form: { id: string; name: string; slug: string; fields: AdminFormField[] }
  submissions: AdminFormSubmission[]
  page: number
  perPage: number
  total: number
  /** Every submission of the form by status, for the filter tabs. */
  counts: Record<FormSubmissionStatus, number>
}
