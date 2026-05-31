// ── Field schema ─────────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'color'
  | 'select'
  | 'toggle'
  | 'image'
  | 'url'
  | 'spacing'

export interface SelectOption {
  label: string
  value: string
}

export interface SpacingValue {
  top: number
  right: number
  bottom: number
  left: number
  unit: 'px' | 'rem' | '%'
}

export interface FieldSchema {
  key: string
  label: string
  type: FieldType
  default?: unknown
  placeholder?: string
  options?: SelectOption[]     // for 'select'
  min?: number                 // for 'number'
  max?: number
  step?: number
  rows?: number                // for 'textarea'
  /** Hide this field unless the function returns true for the current block props */
  condition?: (props: Record<string, unknown>) => boolean
}

// ── Block definition ──────────────────────────────────────────────────────────

export interface CanvasBlockDefinition {
  id: string
  name: string
  description?: string
  icon: string
  category: 'layout' | 'content' | 'media' | 'cta' | 'plugin'
  fields: FieldSchema[]
  defaultProps: Record<string, unknown>
  component: string            // globally-registered Vue component name
  /** CSS background colour string shown in BlockPicker preview tile */
  thumbnailColor?: string
}

// ── Runtime canvas data ───────────────────────────────────────────────────────

export interface CanvasBlockData {
  id: string                   // uuid, client-generated
  type: string                 // matches CanvasBlockDefinition.id
  props: Record<string, unknown>
}

export interface CanvasContent {
  type: 'canvas'
  blocks: CanvasBlockData[]
}

export function isCanvasContent(value: unknown): value is CanvasContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as CanvasContent).type === 'canvas' &&
    Array.isArray((value as CanvasContent).blocks)
  )
}

export function emptyCanvas(): CanvasContent {
  return { type: 'canvas', blocks: [] }
}
