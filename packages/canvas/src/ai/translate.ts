import type { CanvasBlockData, CanvasBlockDefinition, FieldSchema } from '../types'
import { getBlockDefinition } from '../blocks/definitions'

// Which canvas strings AI translation touches, derived from the block definitions rather
// than a hand-kept list of prop names. List fields (FAQ items, pricing features, footer
// links) are stored as JSON strings; they're unpacked here so each visible string is
// translated on its own — handing the model a whole JSON blob and hoping it comes back
// valid used to be able to break the block entirely (it renders nothing on a parse error).
//
// Paths: "<blockId>.<prop>" for a plain field, "<blockId>.<prop>.<i>" for a string-list
// item, "<blockId>.<prop>.<i>.<subKey>" for an object-list item's sub-field.

const TEXT_TYPES = new Set<FieldSchema['type']>(['text', 'textarea', 'richtext'])

// Blocks with no server-visible definition (dynamic-plugin blocks keep theirs in KV,
// client-side) fall back to these conventional copy-carrying prop names.
const FALLBACK_TEXT_KEYS = new Set(['title', 'subtitle', 'description', 'headline', 'subtext', 'content', 'text', 'label', 'caption', 'quote'])

function isTranslatable(f: FieldSchema): boolean {
  return f.translatable !== false && (TEXT_TYPES.has(f.type) || f.type === 'list' || f.type === 'images')
}

function parseList(value: unknown): unknown[] | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

type DefLookup = (type: string) => CanvasBlockDefinition | undefined

function walk(blocks: CanvasBlockData[], visit: (block: CanvasBlockData) => void) {
  for (const block of blocks) {
    visit(block)
    if (block.children) for (const kids of Object.values(block.children)) walk(kids, visit)
  }
}

export function collectCanvasStrings(blocks: CanvasBlockData[], lookup: DefLookup = getBlockDefinition): Map<string, string> {
  const out = new Map<string, string>()
  walk(blocks, (block) => {
    const props = block.props ?? {}
    const def = lookup(block.type)
    if (!def) {
      for (const [key, val] of Object.entries(props)) {
        if (FALLBACK_TEXT_KEYS.has(key) && typeof val === 'string' && val.trim()) out.set(`${block.id}.${key}`, val)
      }
      return
    }
    for (const f of def.fields) {
      if (!isTranslatable(f)) continue
      const val = props[f.key]
      if (TEXT_TYPES.has(f.type)) {
        if (typeof val === 'string' && val.trim()) out.set(`${block.id}.${f.key}`, val)
        continue
      }
      const items = parseList(val)
      if (!items) continue
      items.forEach((item, i) => {
        if (f.type === 'images') {
          const alt = (item as { alt?: unknown } | null)?.alt
          if (typeof alt === 'string' && alt.trim()) out.set(`${block.id}.${f.key}.${i}.alt`, alt)
        }
        else if (f.fields?.length) {
          for (const s of f.fields) {
            if (!TEXT_TYPES.has(s.type) || s.translatable === false) continue
            const v = (item as Record<string, unknown> | null)?.[s.key]
            if (typeof v === 'string' && v.trim()) out.set(`${block.id}.${f.key}.${i}.${s.key}`, v)
          }
        }
        else if (typeof item === 'string' && item.trim()) {
          out.set(`${block.id}.${f.key}.${i}`, item)
        }
      })
    }
  })
  return out
}

/** Returns a copy of `blocks` with every translated path applied; untranslated paths keep their original value. */
export function applyCanvasTranslations(blocks: CanvasBlockData[], translations: Record<string, string>): CanvasBlockData[] {
  return blocks.map((block) => {
    const prefix = `${block.id}.`
    const props: Record<string, unknown> = { ...block.props }
    const listEdits = new Map<string, Array<[string[], string]>>()

    for (const [path, value] of Object.entries(translations)) {
      if (!path.startsWith(prefix)) continue
      const [key, ...rest] = path.slice(prefix.length).split('.')
      if (!key) continue
      if (!rest.length) {
        if (typeof props[key] === 'string') props[key] = value
      }
      else {
        if (!listEdits.has(key)) listEdits.set(key, [])
        listEdits.get(key)!.push([rest, value])
      }
    }

    for (const [key, edits] of listEdits) {
      const items = parseList(props[key])
      if (!items) continue
      for (const [[index, subKey], value] of edits) {
        const i = Number(index)
        if (!Number.isInteger(i) || i < 0 || i >= items.length) continue
        if (subKey === undefined) {
          if (typeof items[i] === 'string') items[i] = value
        }
        else if (items[i] && typeof items[i] === 'object' && typeof (items[i] as Record<string, unknown>)[subKey] === 'string') {
          items[i] = { ...(items[i] as Record<string, unknown>), [subKey]: value }
        }
      }
      props[key] = JSON.stringify(items)
    }

    return {
      ...block,
      props,
      ...(block.children && {
        children: Object.fromEntries(
          Object.entries(block.children).map(([slot, kids]) => [slot, applyCanvasTranslations(kids, translations)]),
        ),
      }),
    }
  })
}
