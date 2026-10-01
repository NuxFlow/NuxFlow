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
  | 'list'

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
  /**
   * For 'list' — the per-item field schema, rendered recursively via FieldRenderer for
   * each array entry (e.g. a list of {label, url} link objects, or {question, answer}
   * FAQ pairs). Omit this for a plain list of strings (e.g. a pricing plan's feature
   * bullets) — items then render as a single text input each instead of a sub-form.
   * The stored value is always a JSON string, matching the existing 'images' field's
   * convention, so it round-trips through the same prop-serialization path every other
   * field type already uses.
   */
  fields?: FieldSchema[]
  /** Hide this field unless the function returns true for the current block props */
  condition?: (props: Record<string, unknown>) => boolean
  /**
   * AI page generation (utils/ai-blocks.ts builds the model's block catalog from these
   * definitions): `false` = the generator never sets this field (focal points and other
   * fine-tuning knobs), a string = extra guidance for the model. 'spacing' fields are
   * always left out, so they need no annotation.
   */
  ai?: false | string
  /**
   * AI translation only considers text/textarea/richtext/list fields; `false` excludes one
   * whose value is an identifier rather than copy (icon classes, slugs, exact-match names,
   * URLs kept in a plain text field) — translating those silently breaks the block.
   */
  translatable?: false
}

/** How the AI page generator may use a block — see utils/ai-blocks.ts. */
export interface BlockAiMeta {
  /** Never offered to the generator (e.g. the footer, which the site layout already renders). */
  exclude?: boolean
  /** When to use the block, shown to the model alongside its fields. */
  hint?: string
  /**
   * Site capabilities the block needs to render anything useful — the block is only
   * offered when every one is present in the generation context.
   */
  requires?: Array<'media' | 'forms' | 'tiers' | 'events' | 'posts'>
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
  /** AI page generation metadata — see BlockAiMeta. */
  ai?: BlockAiMeta
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

/** An AI page-generation request, kept by the editor so "Regenerate" can reopen it prefilled. */
export interface AiGenerateRequest {
  description: string
  tone: 'professional' | 'casual' | 'friendly' | 'bold' | 'playful' | 'technical'
  pageGoal: 'landing' | 'about' | 'product' | 'pricing' | 'contact' | 'blog' | 'general'
  /** Replace the page's blocks, or add the generated sections after them. */
  mode: 'replace' | 'append'
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

// ── Block registry contract ───────────────────────────────────────────────────

/** Metadata shape returned for one registry entry, without the Vue component
 * itself — used by places that only need to render a label/icon (block
 * picker tiles, settings-panel fallback shells). */
export interface CanvasBlockRegistryMeta {
  name: string
  icon?: string
  description?: string
}

/**
 * The contract the host app's block registry (`useBlockRegistry()` in
 * `apps/nuxflow/app/composables/useBlockRegistry.ts`) must satisfy, injected
 * at `'nuxflow:blockRegistry'`. Defined once here so every consumer inside
 * this package (`useCanvas`, `CanvasBlock`, `BlockPicker`, `resolveDefinition`)
 * checks against the same shape instead of each hand-writing its own subset —
 * a mismatch used to only surface as a silent runtime `undefined`, not a type error.
 */
export interface CanvasBlockRegistry {
  meta(id: string): CanvasBlockRegistryMeta | undefined
  resolve(id: string): object | undefined
  getDefinition(id: string): unknown
  all(): Array<{ id: string } & CanvasBlockRegistryMeta>
  dynamicBlocks(): Array<{ id: string } & CanvasBlockRegistryMeta>
}
