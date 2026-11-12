// Starter sites — ready-made sites a new site (setup wizard, hosting sign-up) or an existing
// one (Admin → Starter sites) can start from. Shared by the server, the admin UI and the
// catalog build script (scripts/starters/), so the catalog format is defined once.
//
// Two sources, one format (a NuxFlowBackup-shaped demo.json, optional theme.css, images):
//   - built in (server/utils/starters/builtin.ts): text-only, always available, even offline;
//   - the catalog: a signed catalog.json plus files on a host the NuxFlow project controls
//     (default https://starters.nuxflow.dev/catalog.json), so new starters go live without
//     a release. Every file is listed with its SHA-256 and the list is Ed25519-signed, so a
//     compromised host can't slip script into every site that installs a starter.
import { z } from 'zod'

export const STARTER_ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/

export const starterIdSchema = z.string().regex(STARTER_ID_RE, 'Unknown starter site')

/** What the picker shows for one starter, from either source. */
export interface StarterSummary {
  id: string
  name: string
  description: string
  category: string
  version: string
  source: 'builtin' | 'catalog'
  /** Absolute URL of a preview picture (catalog starters). */
  previewUrl: string | null
  /** Built-in starters have no picture — an icon on a gradient instead. */
  icon: string | null
  gradient: string | null
  imageCount: number
  imageBytes: number
  /** True when it has images, which need real file storage (R2 or Cloudflare Images). */
  needsStorage: boolean
}

/** A catalog starter's install job as the admin sees it (installView(),
 * server/utils/starters/install.ts). */
export interface StarterInstallView {
  id: string
  starterId: string
  starterName: string
  mode: 'fresh' | 'switch'
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  phase: 'resolve' | 'images' | 'apply' | 'done'
  imagesDone: number
  imagesTotal: number
  error: string | null
}

/** What applying a starter did (the parts the admin shows of `ApplyStarterResult`,
 * server/utils/starters/apply.ts). */
export interface StarterApplyResult {
  content: { created: number; updated: number; skipped: number }
  draftedItems: number
  /** Settings the starter has that the site's own value was kept for. */
  settingsKept: string[]
  /** What didn't fit the site's hosting plan. */
  planLimits?: string[]
}

/** POST /api/v1/starters (`install`, `step`, `cancel`): the job, or the result once applied. */
export interface StarterInstallAnswer {
  install: StarterInstallView | null
  result: StarterApplyResult | null
  /** Another request is working on this install right now. */
  busy?: boolean
}

/** GET /api/v1/starters: Admin → Starter sites. (`?installOnly=1` sends only `install`.) */
export interface StartersResponse {
  starters: StarterSummary[]
  /** Why the catalog couldn't be read; the built-in starters are still listed. */
  catalogError: string | null
  /** The site has file storage for starters with images. */
  storageReady: boolean
  install: StarterInstallView | null
  /** The starter this site last installed. */
  applied: { id: string; name: string; at: string } | null
}

// ── Catalog format ────────────────────────────────────────────────────────────

/**
 * A path inside the catalog: relative, forward slashes, no `..`, no scheme or query, so it
 * can only ever resolve to a file under the catalog's own folder.
 */
export function isSafeStarterPath(p: string): boolean {
  if (!/^[\w.\-/]+$/.test(p) || p.length > 300) return false
  if (p.startsWith('/')) return false
  return !p.split('/').some(seg => seg === '' || seg === '.' || seg === '..')
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const pathSchema = z.string().refine(isSafeStarterPath, 'Unsafe path')
const fileSchema = z.object({
  path: pathSchema,
  sha256: sha256Schema,
  size: z.number().int().nonnegative().max(25 * 1024 * 1024),
})

export const STARTER_IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
}

/** How demo.json refers to a bundled image: `images/…` with an image extension. */
export const STARTER_IMAGE_REF_RE = /^images\/[\w.\-/]+\.(?:jpg|jpeg|png|webp|gif|svg|avif|ico)$/i

export const starterCatalogEntrySchema = z.object({
  id: starterIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  category: z.string().max(40).default('General'),
  version: z.string().regex(/^[\w.-]{1,32}$/),
  preview: fileSchema.nullish(),
  demo: fileSchema,
  css: fileSchema.nullish(),
  images: z.array(fileSchema.extend({
    ref: z.string().regex(STARTER_IMAGE_REF_RE).refine(isSafeStarterPath),
  })).max(300).default([]),
})
export type StarterCatalogEntry = z.infer<typeof starterCatalogEntrySchema>

export const starterCatalogPayloadSchema = z.object({
  generatedAt: z.string(),
  starters: z.array(starterCatalogEntrySchema).max(500),
})
export type StarterCatalogPayload = z.infer<typeof starterCatalogPayloadSchema>

/** catalog.json as published: the payload as a string (signed byte for byte) + signature. */
export const starterCatalogFileSchema = z.object({
  format: z.literal('nuxflow-starter-catalog'),
  version: z.literal(1),
  payload: z.string().max(2 * 1024 * 1024),
  signature: z.string().min(16).max(200),
})
export type StarterCatalogFile = z.infer<typeof starterCatalogFileSchema>

const SIGNING_PREFIX = 'nuxflow-starter-catalog-v1\n'

/** The exact bytes the catalog's Ed25519 signature covers. */
export function catalogSigningInput(payload: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(SIGNING_PREFIX + payload)
}

/** Summary of a catalog entry, with its preview resolved against the catalog URL. */
export function summarizeCatalogEntry(entry: StarterCatalogEntry, catalogUrl: string): StarterSummary {
  const imageBytes = entry.images.reduce((sum, i) => sum + i.size, 0)
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    version: entry.version,
    source: 'catalog',
    previewUrl: entry.preview ? new URL(entry.preview.path, catalogUrl).toString() : null,
    icon: null,
    gradient: null,
    imageCount: entry.images.length,
    imageBytes,
    needsStorage: entry.images.length > 0,
  }
}

// ── Settings a starter may change ─────────────────────────────────────────────

// A starter is a design, not someone else's site: it may set how the site looks, but never
// its address, SEO identity, crawler rules, credentials or anything else per-site. Keys
// outside these lists are ignored.
const STARTER_DESIGN_PREFIXES = ['theme.', 'frontend.', 'layout.']
const STARTER_DESIGN_KEYS = new Set(['appearance.custom_head_html', 'appearance.custom_body_html'])
// Filled in only while the site has no value of its own: they're the owner's brand.
const STARTER_FILL_ONLY_KEYS = new Set(['appearance.logo_url', 'appearance.favicon_url', 'seo.title', 'seo.description', 'seo.og_image'])

export type StarterSettingKind = 'design' | 'fill' | null

export function starterSettingKind(key: string): StarterSettingKind {
  if (STARTER_FILL_ONLY_KEYS.has(key)) return 'fill'
  if (key === 'theme.base_theme_id') return null
  if (STARTER_DESIGN_KEYS.has(key) || STARTER_DESIGN_PREFIXES.some(p => key.startsWith(p))) return 'design'
  return null
}

// Custom HTML is often the owner's own (analytics, chat widgets), so it's only replaced when
// it's empty or still exactly what the previous starter wrote.
const OWNER_GUARDED_KEYS = new Set(['appearance.custom_head_html', 'appearance.custom_body_html'])

export interface StarterSettingsPlan {
  write: [string, unknown][]
  clear: string[]
  /** Settings the starter has but the site's own value was kept. */
  kept: string[]
}

/**
 * Decides which settings a starter writes. `current` = the site's stored values (by a stable
 * hash), `previous` = the hashes of what the last starter wrote. A value still equal to what
 * the last starter wrote counts as unset (it wasn't the owner's choice), and one the new
 * starter doesn't set is cleared back to the default — so switching from a dark starter to a
 * light one doesn't leave the old one's colours behind.
 */
export function planStarterSettings(
  starter: Record<string, unknown>,
  current: Map<string, string>,
  previous: Record<string, string>,
  hashOf: (value: unknown) => string,
): StarterSettingsPlan {
  const plan: StarterSettingsPlan = { write: [], clear: [], kept: [] }
  const fromLastStarter = (key: string) => current.has(key) && previous[key] === current.get(key)
  for (const [key, value] of Object.entries(starter)) {
    const kind = starterSettingKind(key)
    if (!kind) continue
    const ownValue = current.has(key) && !fromLastStarter(key)
    if (ownValue && (kind === 'fill' || OWNER_GUARDED_KEYS.has(key))) {
      if (current.get(key) !== hashOf(value)) plan.kept.push(key)
      continue
    }
    plan.write.push([key, value])
  }
  for (const key of Object.keys(previous)) {
    if (key in starter) continue
    if (fromLastStarter(key)) plan.clear.push(key)
  }
  return plan
}

/** Replaces `{{site_name}}` in a demo.json's text with the site's name, JSON-escaped. */
export function fillStarterPlaceholders(demoJson: string, siteName: string): string {
  const escaped = JSON.stringify(siteName).slice(1, -1)
  return demoJson.replaceAll('{{site_name}}', escaped)
}

/** Replaces every image reference in demo.json text in one pass, longest first. */
export function rewriteStarterImageRefs(demoJson: string, urls: Record<string, string>): string {
  const refs = Object.keys(urls).sort((a, b) => b.length - a.length)
  if (refs.length === 0) return demoJson
  const pattern = new RegExp(refs.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  // URLs are inserted into JSON string literals: escape them as such.
  return demoJson.replace(pattern, ref => JSON.stringify(urls[ref]!).slice(1, -1))
}

/**
 * A short fingerprint of a setting value, for telling "still what the last starter wrote"
 * from "changed by the owner". Change detection only — not a security boundary.
 */
export function settingFingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? ''
  let a = 0x811C9DC5
  let b = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5BD1E995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/** What the `starters.applied` setting records about the starter a site last installed. */
export interface AppliedStarter {
  id: string
  name: string
  version: string
  at: string
  /** Fingerprints of the settings it wrote, by key. */
  settings: Record<string, string>
  /**
   * What wrote them: a starter, or a theme bundle's demo import (id `theme:<themeId>`).
   * Absent on records written before theme bundles shared this record = a starter.
   */
  source?: 'starter' | 'theme'
}
