import type { AiPageChange, CanvasBlockData, CanvasBlockDefinition } from '../types'
import { aiFields, normalizeAiBlocks, normalizeAiField, type AiMediaItem, type AiRawBlock } from './blocks'

export type { AiPageChange }

// "Change this page with AI": the model never rewrites the page wholesale. It gets the
// page as a numbered list of blocks and answers with a list of edits — change some fields
// of b3, remove b5, add a block after b2, move b4 to the top — each with a short note.
// applyAiPageEdits() checks every edit against the block definitions (the same checks a
// generated page goes through) and returns the new page plus a plain-English list of what
// changed, which the editor shows next to the highlighted blocks before anyone keeps it.
//
// Why edits rather than a whole new page: everything the model wasn't asked to touch stays
// exactly as it was — padding, colours it never saw, images, ids (so a gallery's client
// picks or an appointment block's bookings stay attached), blocks it can't edit.
//
// Pure TS, no Vue imports (server-safe through '@nuxflow/canvas/ai').

/** One edit as the model returns it (after the server's schema has turned props into a record). */
export interface AiPageEditOp {
  op: 'update' | 'remove' | 'insert' | 'move'
  /** The block's label ("b3") — for update/remove/move. */
  block?: string
  /** update: only the fields to change. insert: the new block's fields. */
  props?: Record<string, unknown>
  /** insert/move: the top-level block it goes after; '' or missing = the top of the page. */
  after?: string
  /** insert: the new block's type and (for blocks with slots) children. */
  type?: string
  children?: AiRawBlock['children']
  /** Plain-English reason, shown to the person reviewing. */
  note?: string
}


export interface AiPageEditResult {
  blocks: CanvasBlockData[]
  changes: AiPageChange[]
  /** Edits that were refused (unknown block, nothing valid to change, a block AI can't edit). */
  skipped: number
}

export interface DescribedPage {
  /** The prompt text: one entry per block, with its label, type and current fields. */
  text: string
  /** Label ("b3") → block id. */
  labels: Map<string, string>
}

// Long values are cut in the prompt. Cutting is announced so the model knows it is only
// seeing the start, and a cut field it rewrites is shown to the reviewer like any change.
const MAX_VALUE_CHARS = 1500
const MAX_PAGE_CHARS = 40_000

function walk(blocks: CanvasBlockData[], visit: (b: CanvasBlockData, parent: CanvasBlockData | null, slot: string | null) => void, parent: CanvasBlockData | null = null, slot: string | null = null) {
  for (const b of blocks) {
    visit(b, parent, slot)
    if (b.children) for (const [s, kids] of Object.entries(b.children)) walk(kids, visit, b, s)
  }
}

function promptValue(def: CanvasBlockDefinition, key: string, value: unknown, media: AiMediaItem[]): unknown {
  const f = def.fields.find(x => x.key === key)!
  const token = (url: unknown) => {
    const i = media.findIndex(m => m.url === url)
    return i >= 0 ? `media:${i}` : '(an image not in the MEDIA LIBRARY — leave it unless asked)'
  }
  if (f.type === 'image') {
    const url = typeof value === 'object' && value !== null ? (value as { url?: unknown }).url : value
    return url ? token(url) : ''
  }
  if (f.type === 'images' && typeof value === 'string') {
    try {
      const items = JSON.parse(value) as Array<{ url?: string }>
      return Array.isArray(items) ? items.map(i => token(i?.url)) : value
    }
    catch {
      return value
    }
  }
  if (typeof value === 'string' && value.length > MAX_VALUE_CHARS) {
    return `${value.slice(0, MAX_VALUE_CHARS)}… (cut short — only rewrite this field if asked to)`
  }
  return value
}

/** The page as the model sees it. Blocks AI can't edit are listed so it knows they're there. */
export function describePageForAi(blocks: CanvasBlockData[], defs: CanvasBlockDefinition[], media: AiMediaItem[] = []): DescribedPage {
  const byId = new Map(defs.map(d => [d.id, d]))
  const labels = new Map<string, string>()
  const lines: string[] = []
  let n = 0
  walk(blocks, (b, parent, slot) => {
    const label = `b${++n}`
    labels.set(label, b.id)
    const where = parent ? `  (inside ${[...labels].find(([, id]) => id === parent.id)?.[0]}, slot ${slot})` : ''
    const def = byId.get(b.type)
    if (!def) {
      lines.push(`${label} ${b.type}${where} — cannot be edited by AI; leave it alone`)
      return
    }
    const fields: Record<string, unknown> = {}
    for (const f of aiFields(def)) {
      const v = b.props?.[f.key]
      if (v === undefined || v === null || v === '') continue
      fields[f.key] = promptValue(def, f.key, v, media)
    }
    lines.push(`${label} ${b.type}${where}\n  ${JSON.stringify(fields)}`)
  })
  let text = lines.join('\n')
  if (text.length > MAX_PAGE_CHARS) text = `${text.slice(0, MAX_PAGE_CHARS)}\n… (the rest of the page is not shown)`
  return { text: text || '(the page is empty)', labels }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function findIn(blocks: CanvasBlockData[], id: string): { list: CanvasBlockData[]; index: number } | null {
  const i = blocks.findIndex(b => b.id === id)
  if (i >= 0) return { list: blocks, index: i }
  for (const b of blocks) {
    if (!b.children) continue
    for (const kids of Object.values(b.children)) {
      const hit = findIn(kids, id)
      if (hit) return hit
    }
  }
  return null
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export interface ApplyAiPageEditsOptions {
  /** Block definitions AI may use — a block of any other type is never changed, removed or moved. */
  defs: CanvasBlockDefinition[]
  media?: AiMediaItem[]
  labels: Map<string, string>
  newId: () => string
  /** Cap on blocks added in one go. */
  maxInserts?: number
}

/** Applies the model's edits to a copy of the page. Never throws on bad model output. */
export function applyAiPageEdits(page: CanvasBlockData[], ops: AiPageEditOp[], opts: ApplyAiPageEditsOptions): AiPageEditResult {
  const blocks = clone(page)
  const byType = new Map(opts.defs.map(d => [d.id, d]))
  const media = opts.media ?? []
  const changes: AiPageChange[] = []
  let skipped = 0
  let inserts = 0
  const maxInserts = opts.maxInserts ?? 8
  const idFor = (label: string | undefined) => (label ? opts.labels.get(label.trim()) : undefined)
  const note = (op: AiPageEditOp) => (op.note ?? '').trim().slice(0, 300)

  /** Where a top-level insert/move lands: after `after`, or the top when it's empty/unknown-but-blank. */
  const rootIndexAfter = (after: string | undefined): number | null => {
    if (!after || !after.trim()) return 0
    const id = idFor(after)
    if (!id) return null
    const i = blocks.findIndex(b => b.id === id)
    return i >= 0 ? i + 1 : null
  }

  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object') { skipped++; continue }

    if (op.op === 'insert') {
      if (inserts >= maxInserts) { skipped++; continue }
      const [made] = normalizeAiBlocks([{ type: op.type ?? '', props: op.props, children: op.children }], { defs: opts.defs, media, newId: opts.newId })
      const at = rootIndexAfter(op.after)
      if (!made || at === null) { skipped++; continue }
      blocks.splice(at, 0, made)
      inserts++
      changes.push({ kind: 'added', blockId: made.id, blockName: byType.get(made.type)?.name ?? made.type, note: note(op) })
      continue
    }

    const id = idFor(op.block)
    const hit = id ? findIn(blocks, id) : null
    const block = hit ? hit.list[hit.index] : undefined
    const def = block ? byType.get(block.type) : undefined
    if (!hit || !block || !def) { skipped++; continue }

    if (op.op === 'update') {
      const changed: string[] = []
      const raw = op.props && typeof op.props === 'object' ? op.props : {}
      for (const f of aiFields(def)) {
        if (!(f.key in raw)) continue
        const v = normalizeAiField(f, raw[f.key], media)
        if (v === undefined || sameValue(v, block.props[f.key])) continue
        block.props[f.key] = v
        changed.push(f.label)
      }
      if (!changed.length) { skipped++; continue }
      const existing = changes.find(c => c.kind === 'updated' && c.blockId === block.id)
      if (existing) existing.fields = [...new Set([...(existing.fields ?? []), ...changed])]
      else changes.push({ kind: 'updated', blockId: block.id, blockName: def.name, note: note(op), fields: changed })
      continue
    }

    if (op.op === 'remove') {
      hit.list.splice(hit.index, 1)
      changes.push({ kind: 'removed', blockId: block.id, blockName: def.name, note: note(op) })
      continue
    }

    if (op.op === 'move') {
      // Top-level blocks only: moving in and out of columns is a job for the editor.
      if (hit.list !== blocks) { skipped++; continue }
      blocks.splice(hit.index, 1)
      const at = rootIndexAfter(op.after)
      if (at === null || op.after?.trim() === op.block?.trim()) {
        blocks.splice(hit.index, 0, block)
        skipped++
        continue
      }
      blocks.splice(at, 0, block)
      if (blocks.indexOf(block) === hit.index) { skipped++; continue }
      changes.push({ kind: 'moved', blockId: block.id, blockName: def.name, note: note(op) })
      continue
    }

    skipped++
  }

  // An update to a block that was later removed isn't a change anyone will see.
  const removed = new Set(changes.filter(c => c.kind === 'removed').map(c => c.blockId))
  return { blocks, changes: changes.filter(c => c.kind === 'removed' || !removed.has(c.blockId)), skipped }
}
