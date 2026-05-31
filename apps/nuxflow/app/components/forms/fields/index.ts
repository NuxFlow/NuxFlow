// Field component registry — maps field type slug to component name
export const FIELD_COMPONENTS: Record<string, string> = {
  text: 'FormsFieldsTextField',
  number: 'FormsFieldsNumberField',
  email: 'FormsFieldsEmailField',
  select: 'FormsFieldsSelectField',
  radio: 'FormsFieldsRadioField',
  checkbox: 'FormsFieldsCheckboxField',
  date: 'FormsFieldsDateField',
  file: 'FormsFieldsFileField',
  computed: 'FormsFieldsComputedField',
  signature: 'FormsFieldsSignatureField',
}

export interface FormFieldDefinition {
  id: string
  type: keyof typeof FIELD_COMPONENTS
  label: string
  placeholder?: string
  required?: boolean
  helpText?: string
  options?: { label: string; value: string }[]
  expression?: string
  conditions?: unknown[]
}
