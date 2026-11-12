// Custom fields on content types (Admin → Content types): the definitions, kept in
// `content_types.schema.fields`, and each item's values, kept in `content_items.fields`.
// Shared by the server (checking what's saved), the editor and public pages. Import-free.

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date' | 'url'

export const CUSTOM_FIELD_TYPES: Array<{ value: CustomFieldType; label: string }> = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'select', label: 'One choice' },
  { value: 'multiselect', label: 'Several choices' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'Link' },
]

export interface CustomFieldDef {
  /** The value's key — lower-case letters, digits and underscores, unique in the type. */
  key: string
  label: string
  type: CustomFieldType
  /** The choices, for select and multiselect. */
  options?: string[]
  required?: boolean
  /** Written before / after a number: "£" 250,000, 3 "bedrooms". */
  prefix?: string
  suffix?: string
  /** Listed on the item's public page. On unless switched off. */
  showOnPage?: boolean
  /** Offered as a filter on listings of this type. */
  filterable?: boolean
}

export type CustomFieldValue = string | number | boolean | string[]
export type CustomFieldValues = Record<string, CustomFieldValue>

export const MAX_CUSTOM_FIELDS = 40
const MAX_OPTIONS = 50
const MAX_TEXT = 2000
const MAX_TEXTAREA = 10_000
const KEY = /^[a-z][a-z0-9_]{0,39}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TYPES = new Set<string>(CUSTOM_FIELD_TYPES.map(t => t.value))

/** "Number of bedrooms" → "number_of_bedrooms". */
export function fieldKeyFrom(label: string): string {
  const key = label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40)
  return key || 'field'
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

/**
 * A content type's field definitions from its stored `schema`, leniently: bad entries are
 * dropped, never thrown, so one odd field can't break the editor or a page.
 */
export function parseFieldDefs(schema: unknown): CustomFieldDef[] {
  const list = schema && typeof schema === 'object' ? (schema as { fields?: unknown }).fields : undefined
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const defs: CustomFieldDef[] = []
  for (const raw of list.slice(0, MAX_CUSTOM_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as Record<string, unknown>
    if (typeof f.key !== 'string' || !KEY.test(f.key) || seen.has(f.key)) continue
    if (typeof f.type !== 'string' || !TYPES.has(f.type)) continue
    seen.add(f.key)
    const type = f.type as CustomFieldType
    const options = type === 'select' || type === 'multiselect'
      ? [...new Set((Array.isArray(f.options) ? f.options : []).map(o => str(o, 100)).filter((o): o is string => Boolean(o)))].slice(0, MAX_OPTIONS)
      : undefined
    defs.push({
      key: f.key,
      label: str(f.label, 100) ?? f.key,
      type,
      ...(options ? { options } : {}),
      ...(f.required === true ? { required: true } : {}),
      ...(type === 'number' && str(f.prefix, 10) ? { prefix: str(f.prefix, 10) } : {}),
      ...(type === 'number' && str(f.suffix, 20) ? { suffix: str(f.suffix, 20) } : {}),
      ...(f.showOnPage === false ? { showOnPage: false } : {}),
      ...(f.filterable === true ? { filterable: true } : {}),
    })
  }
  return defs
}

/**
 * Checks definitions sent from Admin → Content types. Returns the first problem in plain
 * words, or null. (Saving then goes through parseFieldDefs().)
 */
export function fieldDefsProblem(list: unknown): string | null {
  if (!Array.isArray(list)) return 'Fields must be a list.'
  if (list.length > MAX_CUSTOM_FIELDS) return `A content type can have up to ${MAX_CUSTOM_FIELDS} fields.`
  const keys = new Set<string>()
  for (const raw of list) {
    const f = (raw ?? {}) as Record<string, unknown>
    const name = typeof f.label === 'string' && f.label.trim() ? `"${f.label.trim()}"` : 'A field'
    if (typeof f.label !== 'string' || !f.label.trim()) return 'Every field needs a name.'
    if (typeof f.key !== 'string' || !KEY.test(f.key)) return `${name} needs a key of lower-case letters, numbers and underscores, starting with a letter.`
    if (keys.has(f.key)) return `Two fields use the key "${f.key}". Each needs its own.`
    keys.add(f.key)
    if (typeof f.type !== 'string' || !TYPES.has(f.type)) return `${name} has an unknown type.`
    if ((f.type === 'select' || f.type === 'multiselect') && (!Array.isArray(f.options) || !f.options.some(o => typeof o === 'string' && o.trim()))) {
      return `${name} needs at least one choice.`
    }
  }
  return null
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * Checks an item's values against its type's fields and returns what to store: unknown keys
 * and empty values dropped, numbers as numbers, choices only from the list. Throws an Error
 * with a message for the editor on the first problem (callers turn it into a 422).
 */
export function normalizeFieldValues(defs: CustomFieldDef[], input: unknown, opts: { requireAll?: boolean } = {}): CustomFieldValues {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const out: CustomFieldValues = {}
  for (const def of defs) {
    const v = values[def.key]
    if (isEmpty(v)) {
      if (def.required && opts.requireAll) throw new Error(`Fill in "${def.label}".`)
      continue
    }
    switch (def.type) {
      case 'text':
      case 'textarea': {
        if (typeof v !== 'string') throw new Error(`"${def.label}" should be text.`)
        const max = def.type === 'text' ? MAX_TEXT : MAX_TEXTAREA
        if (v.length > max) throw new Error(`"${def.label}" is too long.`)
        if (v.trim()) out[def.key] = v.trim()
        break
      }
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number.NaN
        if (!Number.isFinite(n)) throw new Error(`"${def.label}" should be a number.`)
        out[def.key] = n
        break
      }
      case 'boolean':
        if (typeof v !== 'boolean') throw new Error(`"${def.label}" should be yes or no.`)
        out[def.key] = v
        break
      case 'select':
        if (typeof v !== 'string' || !def.options?.includes(v)) throw new Error(`Choose one of the options for "${def.label}".`)
        out[def.key] = v
        break
      case 'multiselect': {
        if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !def.options?.includes(x))) throw new Error(`Choose from the options for "${def.label}".`)
        out[def.key] = [...new Set(v as string[])]
        break
      }
      case 'date':
        if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Error(`"${def.label}" should be a date.`)
        out[def.key] = v
        break
      case 'url': {
        if (typeof v !== 'string' || !/^https?:\/\/\S+$/i.test(v.trim()) || v.length > MAX_TEXT) throw new Error(`"${def.label}" should be a web address starting with https://`)
        out[def.key] = v.trim()
        break
      }
    }
  }
  return out
}

/** A value as visitors read it: "£250,000", "Yes", "Parking, Garden", "12 Mar 2027". */
export function formatFieldValue(def: CustomFieldDef, value: CustomFieldValue | undefined, locale = 'en'): string {
  if (value === undefined || value === null || value === '') return ''
  switch (def.type) {
    case 'number': {
      let n: string
      try {
        n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value))
      }
      catch {
        n = String(value)
      }
      return `${def.prefix ?? ''}${n}${def.suffix ? ` ${def.suffix}` : ''}`
    }
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'date':
      try {
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
      }
      catch {
        return String(value)
      }
    default:
      return String(value)
  }
}

export interface FieldDetail {
  key: string
  label: string
  type: CustomFieldType
  /** Formatted for reading. */
  text: string
  /** Set for links, so the page can make one. */
  href?: string
}

/** The details a public page lists, in the type's order. */
export function pageDetails(defs: CustomFieldDef[], values: CustomFieldValues | null | undefined, locale = 'en'): FieldDetail[] {
  if (!values) return []
  return defs
    .filter(d => d.showOnPage !== false && values[d.key] !== undefined)
    .map(d => ({
      key: d.key,
      label: d.label,
      type: d.type,
      text: formatFieldValue(d, values[d.key], locale),
      ...(d.type === 'url' ? { href: String(values[d.key]) } : {}),
    }))
    .filter(d => d.text !== '')
}
