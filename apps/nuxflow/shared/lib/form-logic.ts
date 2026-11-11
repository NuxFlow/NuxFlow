// Multi-step forms and "show this field only when…" for Form Builder forms. The same rules
// run in the visitor's browser (DynamicFormBlock.vue) and on submit (submit.post.ts), so a
// hidden question is never required and never kept. Import-free.

export type ShowIfOp = 'equals' | 'not_equals' | 'contains' | 'filled' | 'empty'

export interface ShowIf {
  /** The `name` of an earlier field. */
  field: string
  op: ShowIfOp
  /** Compared as text, ignoring case and surrounding spaces. Unused for filled/empty. */
  value?: string
}

export const SHOW_IF_OPS: Array<{ value: ShowIfOp; label: string; needsValue: boolean }> = [
  { value: 'equals', label: 'is', needsValue: true },
  { value: 'not_equals', label: 'is not', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'filled', label: 'is filled in', needsValue: false },
  { value: 'empty', label: 'is empty', needsValue: false },
]

/** The parts of a form field these rules read. */
export interface LogicField {
  name: string
  type: string
  label?: string
  showIf?: ShowIf | null
}

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/** True when a value counts as answered: text, a ticked box, a choice, a file. */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  return true
}

function matches(value: unknown, cond: ShowIf): boolean {
  const filled = isFilled(value)
  if (cond.op === 'filled') return filled
  if (cond.op === 'empty') return !filled
  const want = norm(cond.value)
  // A checkbox group's value is a list: "is" means one of the ticked options is it.
  const values = Array.isArray(value) ? value.map(norm) : [norm(value)]
  if (cond.op === 'equals') return values.includes(want)
  if (cond.op === 'not_equals') return !values.includes(want)
  return values.some(v => v.includes(want))
}

/**
 * Whether a field is shown, given the answers so far. A field whose condition depends on a
 * hidden field is hidden too (that field's answer doesn't count). Conditions only look at
 * fields that exist; one naming a missing field shows the field. Loops are cut short.
 */
export function isFieldShown(field: LogicField, values: Record<string, unknown>, fields: LogicField[], depth = 0): boolean {
  const cond = field.showIf
  if (!cond || !cond.field || field.type === 'step') return true
  if (depth > 20) return false
  const target = fields.find(f => f.name === cond.field)
  if (!target || target === field) return true
  const targetShown = isFieldShown(target, values, fields, depth + 1)
  return matches(targetShown ? values[target.name] : undefined, cond)
}

/** Names of the fields that are hidden by their conditions right now. */
export function hiddenFieldNames(fields: LogicField[], values: Record<string, unknown>): Set<string> {
  return new Set(fields.filter(f => f.type !== 'step' && !isFieldShown(f, values, fields)).map(f => f.name))
}

export interface FormStep<F extends LogicField> {
  /** The step's heading (the Step field's label), '' for a form's untitled first step. */
  title: string
  fields: F[]
}

/**
 * Splits a form into its steps at each `step` field. A form without any is one step. Empty
 * steps (two breaks in a row, or a break at the very end) are dropped.
 */
export function formSteps<F extends LogicField>(fields: F[]): FormStep<F>[] {
  const steps: FormStep<F>[] = [{ title: '', fields: [] }]
  for (const f of fields) {
    if (f.type === 'step') steps.push({ title: f.label ?? '', fields: [] })
    else steps.at(-1)!.fields.push(f)
  }
  return steps.filter(s => s.fields.length > 0)
}

/** Reads a stored `showIf` leniently (it's JSON from the form's fields column). */
export function parseShowIf(value: unknown): ShowIf | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.field !== 'string' || !v.field) return null
  if (!SHOW_IF_OPS.some(o => o.value === v.op)) return null
  return { field: v.field, op: v.op as ShowIfOp, ...(typeof v.value === 'string' ? { value: v.value.slice(0, 200) } : {}) }
}

/** "Shown when Service is Boiler repair" — for the builder's field list. */
export function describeShowIf(cond: ShowIf, fields: LogicField[]): string {
  const target = fields.find(f => f.name === cond.field)
  const op = SHOW_IF_OPS.find(o => o.value === cond.op)
  return `Shown when ${target?.label || cond.field} ${op?.label ?? cond.op}${op?.needsValue ? ` "${cond.value ?? ''}"` : ''}`
}
