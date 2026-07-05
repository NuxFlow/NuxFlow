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
  | 'images'
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

/** A named child drop-zone a container block exposes, e.g. a Columns block's col1..col4. */
export interface BlockSlot {
  id: string
  label: string
  /** Hide this slot's drop-zone unless the function returns true for the current
   * block props — e.g. Columns hides col3/col4 when `columns` is '2'. Existing
   * children in a hidden slot are preserved, just not rendered or droppable,
   * so increasing the count later restores them. Mirrors FieldSchema.condition. */
  condition?: (props: Record<string, unknown>) => boolean
}

export interface CanvasBlockDefinition {
  id: string
  name: string
  description?: string
  icon: string
  category: 'layout' | 'content' | 'media' | 'cta' | 'forms' | 'advanced' | 'commerce'
  fields: FieldSchema[]
  defaultProps: Record<string, unknown>
  component: string            // globally-registered Vue component name
  /** CSS background colour string shown in BlockPicker preview tile */
  thumbnailColor?: string
  /**
   * Named child drop-zones this block exposes, e.g. a Columns block declares
   * col1..col4. Blocks without `slots` are leaves — they cannot contain other blocks.
   * The component named by `component` must render a real Vue `<slot :name="id">`
   * per declared slot for children to actually appear.
   */
  slots?: BlockSlot[]
}

// ── Runtime canvas data ───────────────────────────────────────────────────────

export interface CanvasBlockData {
  id: string                   // uuid, client-generated
  type: string                 // matches CanvasBlockDefinition.id
  props: Record<string, unknown>
  /**
   * Child blocks nested inside this block's slots, keyed by slot id. Only present
   * on blocks whose definition declares `slots`. Always read via getSlotChildren()
   * (useCanvas.ts) rather than direct indexing — slot arrays are created lazily.
   */
  children?: Record<string, CanvasBlockData[]>
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
