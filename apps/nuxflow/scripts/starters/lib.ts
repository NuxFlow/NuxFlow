// The pure part of `pnpm starters:build` (build.ts does the files, signing and upload).
// Tested in tests/unit/starter-scripts.test.ts.
//
// A starter folder holds:
//   starter.json   { id, name, description, category, version }  (theme.json is read too)
//   demo.json      the site content — a NuxFlow backup / theme demo.json
//   theme.css      optional
//   preview.jpg    optional (.png/.webp too) — the picture on the picker card
//   images/…       optional — files demo.json refers to as "images/<name>"
import {
  STARTER_IMAGE_REF_RE,
  STARTER_IMAGE_TYPES,
  starterCatalogEntrySchema,
  type StarterCatalogEntry,
  type StarterCatalogPayload,
} from '../../shared/lib/starters'

export interface StarterMeta {
  id: string
  name: string
  description: string
  category: string
  version: string
}

export interface SourceFile {
  /** Path inside the starter folder, forward slashes. */
  path: string
  bytes: Uint8Array
}

export interface OutputFile {
  key: string
  bytes: Uint8Array
  contentType: string
  cacheControl: string
}

/** Versioned files never change once published, so they can be cached for good. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
/** catalog.json changes whenever a starter is added. */
export const CATALOG_CACHE = 'public, max-age=300'

export function slugifyId(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48)
}

/** starter.json (falling back to theme.json's name/version and the folder name). */
export function readStarterMeta(folderName: string, starterJson: unknown, themeJson: unknown): StarterMeta {
  const s = (starterJson && typeof starterJson === 'object' ? starterJson : {}) as Record<string, unknown>
  const t = (themeJson && typeof themeJson === 'object' ? themeJson : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const name = str(s.name) || str(t.name) || folderName
  return {
    id: str(s.id) || slugifyId(folderName),
    name,
    description: str(s.description) || str(t.description),
    category: str(s.category) || 'General',
    version: str(s.version) || str(t.version) || '1.0.0',
  }
}

export function contentTypeFor(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  const ext = path.split('.').pop()!.toLowerCase()
  return STARTER_IMAGE_TYPES[ext] ?? 'application/octet-stream'
}

/** Every "images/…" string demo.json mentions (also inside escaped HTML). */
export function imageRefsIn(demoJson: string): Set<string> {
  const refs = new Set<string>()
  for (const m of demoJson.matchAll(/images\/[\w.\-/]+\.(?:jpg|jpeg|png|webp|gif|svg|avif|ico)/gi)) refs.add(m[0])
  return refs
}

export interface BuiltStarter {
  entry: StarterCatalogEntry
  files: OutputFile[]
  /** Problems worth telling the author about (nothing that stops the build). */
  warnings: string[]
}

/**
 * Turns one starter folder into its catalog entry and the files to publish. Only images
 * demo.json actually uses are published; ones it refers to but lacks are reported.
 */
export function buildStarter(
  meta: StarterMeta,
  files: SourceFile[],
  sha256: (bytes: Uint8Array) => string,
): BuiltStarter {
  const warnings: string[] = []
  const byPath = new Map(files.map(f => [f.path, f]))
  const demo = byPath.get('demo.json')
  if (!demo) throw new Error(`${meta.id}: demo.json is missing`)
  const demoText = new TextDecoder().decode(demo.bytes)
  try {
    JSON.parse(demoText)
  } catch {
    throw new Error(`${meta.id}: demo.json is not valid JSON`)
  }

  const base = `${meta.id}/${meta.version}/`
  const out: OutputFile[] = []
  const publish = (path: string, bytes: Uint8Array) => {
    out.push({ key: base + path, bytes, contentType: contentTypeFor(path), cacheControl: IMMUTABLE })
    return { path: base + path, sha256: sha256(bytes), size: bytes.byteLength }
  }

  const images: StarterCatalogEntry['images'] = []
  for (const ref of [...imageRefsIn(demoText)].sort()) {
    const file = byPath.get(ref)
    if (!file) {
      warnings.push(`${meta.id}: demo.json mentions ${ref}, but there's no such file`)
      continue
    }
    if (!STARTER_IMAGE_REF_RE.test(ref)) continue
    images.push({ ref, ...publish(ref, file.bytes) })
  }
  const unused = files.filter(f => f.path.startsWith('images/') && !images.some(i => i.ref === f.path))
  if (unused.length) warnings.push(`${meta.id}: ${unused.length} image(s) in images/ aren't used by demo.json and were left out`)

  const css = byPath.get('theme.css')
  const preview = ['preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp'].map(p => byPath.get(p)).find(Boolean)
  if (!preview) warnings.push(`${meta.id}: no preview.jpg — the picker will show a plain card`)

  const entry = starterCatalogEntrySchema.parse({
    ...meta,
    demo: publish('demo.json', demo.bytes),
    css: css ? publish('theme.css', css.bytes) : null,
    preview: preview ? publish(preview.path, preview.bytes) : null,
    images,
  })
  return { entry, files: out, warnings }
}

export function catalogPayload(entries: StarterCatalogEntry[], now = new Date()): StarterCatalogPayload {
  const ids = new Set<string>()
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`Two starters have the id "${e.id}"`)
    ids.add(e.id)
  }
  return { generatedAt: now.toISOString(), starters: [...entries].sort((a, b) => a.name.localeCompare(b.name)) }
}
