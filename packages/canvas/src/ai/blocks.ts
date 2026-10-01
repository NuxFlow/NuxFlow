import type { BlockAiMeta, CanvasBlockData, CanvasBlockDefinition, FieldSchema } from '../types'
import { CANVAS_BLOCKS } from '../blocks/definitions'

// The AI page generator's view of the block library, built from CANVAS_BLOCKS itself so it
// can't drift from the real blocks the way the hand-written catalog it replaces did (that
// one covered 11 of ~22 blocks and still described list fields as raw JSON). Two halves:
//
//  - buildBlockCatalog(): the prompt text describing each usable block and its fields.
//  - normalizeAiBlocks(): turns whatever the model returned into props the components can
//    actually render — unknown blocks/fields dropped, selects/colours/URLs validated, list
//    fields serialized to the JSON strings the components parse, media references resolved.
//
// Pure TS with no Vue imports, so the server can use it through the '@nuxflow/canvas/ai'
// subpath without pulling in the component barrel.

export type AiCapability = NonNullable<BlockAiMeta['requires']>[number]

/** A media-library image the model may reference as `media:<index>`. */
export interface AiMediaItem {
  url: string
  alt?: string | null
  width?: number | null
  height?: number | null
}

/** One block as the model returns it — `children` only on blocks that declare slots. */
export interface AiRawBlock {
  type: string
  props?: Record<string, unknown>
  children?: Array<{ slot: string; blocks: AiRawBlock[] }>
}

/** Blocks the generator may use, given which site capabilities are present. */
export function aiBlockDefinitions(capabilities: ReadonlySet<AiCapability>, blocks: CanvasBlockDefinition[] = CANVAS_BLOCKS): CanvasBlockDefinition[] {
  return blocks.filter(b => !b.ai?.exclude && (b.ai?.requires ?? []).every(c => capabilities.has(c)))
}

/** Fields the generator may set on a block. Padding is the theme's/editor's business. */
export function aiFields(def: CanvasBlockDefinition): FieldSchema[] {
  return def.fields.filter(f => f.ai !== false && f.type !== 'spacing')
}

function describeValue(f: FieldSchema): string {
  switch (f.type) {
    case 'select':
      return (f.options ?? []).map(o => JSON.stringify(o.value)).join(' | ')
    case 'toggle':
      return 'boolean'
    case 'number':
      return `number${f.min !== undefined || f.max !== undefined ? ` ${f.min ?? ''}-${f.max ?? ''}` : ''}`
    case 'color':
      return 'hex colour'
    case 'url':
      return 'URL or site path (e.g. /contact)'
    case 'richtext':
      return 'HTML using <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a href>'
    case 'textarea':
      return 'text (may be a few sentences)'
    case 'image':
      return '"media:<n>" from MEDIA LIBRARY'
    case 'images':
      return 'array of "media:<n>" from MEDIA LIBRARY'
    case 'list':
      return f.fields?.length
        ? `array of { ${f.fields.map(s => `${s.key}: ${s.type === 'url' ? 'URL' : 'string'}`).join(', ')} }`
        : 'array of strings'
    default:
      return 'string'
  }
}

/** Prompt text describing every usable block, its slots, and its fields. */
export function buildBlockCatalog(defs: CanvasBlockDefinition[]): string {
  return defs.map((def) => {
    const lines = [`${def.id} — ${def.name}: ${def.description ?? ''}${def.ai?.hint ? ` ${def.ai.hint}` : ''}`]
    if (def.slots?.length) {
      lines.push(`  child slots: ${def.slots.map(s => s.id).join(', ')} (children may not themselves have child slots)`)
    }
    for (const f of aiFields(def)) {
      lines.push(`  - ${f.key} (${f.label}): ${describeValue(f)}${typeof f.ai === 'string' ? ` — ${f.ai}` : ''}`)
    }
    return lines.join('\n')
  }).join('\n\n')
}

// ── Normalization ─────────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MEDIA_REF_RE = /^media:(\d+)$/

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** Site-relative paths, anchors, and http(s)/mailto/tel only — never javascript: etc. */
export function safeAiUrl(value: unknown): string | undefined {
  const s = asString(value)?.trim()
  if (s === undefined) return undefined
  if (s === '' || s.startsWith('/') || s.startsWith('#')) return s
  return /^(?:https?:\/\/|mailto:|tel:)/i.test(s) ? s : undefined
}

function parseArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : undefined
    }
    catch {
      return undefined
    }
  }
  return undefined
}

function resolveMedia(value: unknown, media: AiMediaItem[]): AiMediaItem | undefined {
  const s = asString(value)?.trim()
  if (!s) return undefined
  const ref = MEDIA_REF_RE.exec(s)
  if (ref) return media[Number(ref[1])]
  // The model occasionally echoes a URL from the list instead of its token — accept
  // exactly those, never an arbitrary URL it made up.
  return media.find(m => m.url === s)
}

function normalizeField(f: FieldSchema, value: unknown, media: AiMediaItem[]): unknown {
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'richtext':
      return asString(value)
    case 'url':
      return safeAiUrl(value)
    case 'number': {
      const n = typeof value === 'number' ? value : Number(asString(value))
      if (!Number.isFinite(n)) return undefined
      return Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n))
    }
    case 'toggle':
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === 'false') return value === 'true'
      return undefined
    case 'select': {
      const s = asString(value)
      return s !== undefined && (f.options ?? []).some(o => o.value === s) ? s : undefined
    }
    case 'color': {
      const s = asString(value)?.trim()
      return s && HEX_RE.test(s) ? s : undefined
    }
    case 'image': {
      const m = resolveMedia(value, media)
      return m ? { url: m.url, ...(m.width ? { width: m.width } : {}), ...(m.height ? { height: m.height } : {}) } : undefined
    }
    case 'images': {
      const items = parseArray(value)
      if (!items) return undefined
      const resolved = items.flatMap((item) => {
        const ref = typeof item === 'object' && item !== null ? (item as { url?: unknown }).url : item
        const m = resolveMedia(ref, media)
        return m ? [{ url: m.url, alt: m.alt ?? '' }] : []
      })
      return JSON.stringify(resolved)
    }
    case 'list': {
      const items = parseArray(value)
      if (!items) return undefined
      const sub = f.fields
      const cleaned = sub?.length
        ? items.flatMap((item) => {
            if (typeof item !== 'object' || item === null) return []
            const out: Record<string, string> = {}
            for (const s of sub) {
              const v = s.type === 'url' ? safeAiUrl((item as Record<string, unknown>)[s.key]) : asString((item as Record<string, unknown>)[s.key])
              if (v !== undefined) out[s.key] = v
            }
            return Object.keys(out).length ? [out] : []
          })
        : items.flatMap(item => (asString(item) !== undefined ? [asString(item)!] : []))
      return JSON.stringify(cleaned)
    }
    default:
      return undefined
  }
}

export interface NormalizeAiBlocksOptions {
  /** Block definitions the model was offered — anything else it returns is dropped. */
  defs: CanvasBlockDefinition[]
  media?: AiMediaItem[]
  newId: () => string
}

/**
 * Validates and cleans model output into renderable canvas blocks. Starts every block
 * from its definition's defaultProps (exactly what the editor's "add block" does), then
 * layers on each field the model set that survives validation — so a malformed value
 * falls back to the block's normal default rather than rendering broken.
 */
export function normalizeAiBlocks(raw: unknown, opts: NormalizeAiBlocksOptions, depth = 0): CanvasBlockData[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map(opts.defs.map(d => [d.id, d]))
  const media = opts.media ?? []
  const out: CanvasBlockData[] = []

  for (const item of raw as AiRawBlock[]) {
    if (typeof item !== 'object' || item === null) continue
    const def = byId.get(item.type)
    // One level of nesting only: a Columns block inside a Columns block is never useful
    // output from a generator, and capping depth keeps the schema non-recursive.
    if (!def || (depth > 0 && def.slots?.length)) continue

    const props: Record<string, unknown> = JSON.parse(JSON.stringify(def.defaultProps))
    const rawProps = item.props && typeof item.props === 'object' ? item.props : {}
    for (const f of aiFields(def)) {
      if (!(f.key in rawProps)) continue
      const v = normalizeField(f, rawProps[f.key], media)
      if (v !== undefined) props[f.key] = v
    }

    const block: CanvasBlockData = { id: opts.newId(), type: def.id, props }

    if (def.slots?.length && Array.isArray(item.children)) {
      const slotIds = new Set(def.slots.map(s => s.id))
      const children: Record<string, CanvasBlockData[]> = {}
      for (const group of item.children) {
        if (!group || !slotIds.has(group.slot)) continue
        const kids = normalizeAiBlocks(group.blocks, opts, depth + 1)
        if (kids.length) children[group.slot] = [...(children[group.slot] ?? []), ...kids]
      }
      if (Object.keys(children).length) {
        block.children = children
        // A Columns block only renders col3/col4 when its `columns` prop says so — the
        // model often fills the slots without updating the count, which would silently
        // hide those children. Raise the count to cover every filled slot.
        const columnsField = def.fields.find(f => f.key === 'columns' && f.type === 'select')
        if (columnsField) {
          const highest = Math.max(...Object.keys(children).map(s => Number(/^col(\d)$/.exec(s)?.[1] ?? 0)))
          if (highest > Number(props.columns ?? 0) && columnsField.options?.some(o => o.value === String(highest))) {
            props.columns = String(highest)
          }
        }
      }
    }

    out.push(block)
  }
  return out
}
