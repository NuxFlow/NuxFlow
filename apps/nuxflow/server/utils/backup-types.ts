// ── Backup format types, validation, and restore option/result shapes ─────────
// Split out of backup.ts: this file owns everything that describes the *shape* of a
// backup — the exported NuxFlowBackup interface tree, its runtime Zod validation, and
// the small pure helpers (parseBackupJson, rewriteImageUrls) that operate purely on that
// shape with no DB access. RestoreOptions/RestoreResult live here too even though they're
// restore-specific (not export-specific) because every file under backup-restore/ needs
// them, and this is the one file every one of those already depends on transitively via
// the backup schema types — see backup.ts for the orchestrator that wires them together.

import { z } from 'zod'

// ── Backup format types ───────────────────────────────────────────────────────

export interface BackupContentType {
  slug: string
  name: string
  singularName: string
  icon: string | null
  isBuiltIn: boolean
  hasRevisions: boolean
  hasComments: boolean
}

export interface BackupContentItem {
  typeSlug: string
  slug: string
  title: string
  status: string
  visibility: string
  content: unknown
  excerpt: string | null
  seoTitle: string | null
  seoDescription: string | null
  ogImage: string | null
  publishedAt: string | null
  settings: Record<string, unknown> | null
  termSlugs: string[] // "{taxonomySlug}/{termSlug}"
  locale: string | null
  sourceItemSlug: string | null
}

export interface BackupTerm {
  slug: string
  name: string
  description: string | null
  parentSlug: string | null
}

export interface BackupTaxonomy {
  slug: string
  name: string
  isHierarchical: boolean
  terms: BackupTerm[]
}

export interface BackupMenu {
  name: string
  location: string | null
  items: unknown[]
}

export interface BackupForm {
  slug: string
  name: string
  fields: unknown[]
  notifications: unknown
  redirectUrl: string | null
  status: string
}

export interface BackupMediaItem {
  id: string
  originalName: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  altText: string | null
  caption: string | null
  url: string
  zipPath: string | null  // relative path inside the backup zip; null = not bundled
}

// Theme CSS and the customizer's generated CSS live only in KV (see cf-env.ts /
// putThemeCSS) — never mirrored to D1 — so a D1-only backup can restore every page but
// not a site's actual look. `css`/`demo` are the raw KV payloads, captured here so the
// backup is self-contained even if the KV namespace is later lost or wiped.
export interface BackupTheme {
  packageName: string
  name: string
  version: string
  isActive: boolean
  hasCss: boolean
  settings: Record<string, unknown> | null
  css: string | null
  demo: string | null
}

// `pluginId` mirrors dynamicPlugins.id, which (unlike every other table here) is the
// publisher-assigned manifest id, not a generated ulid — it's both the KV key segment
// and the primary key, so it's the natural restore-matching key. serverCode/clientBundle
// are the raw KV code payloads; signature/checksums travel alongside them so a restore
// can re-verify them exactly as the install endpoint does, rather than trusting a
// user-editable backup.json to carry unmodified code.
export interface BackupDynamicPlugin {
  pluginId: string
  name: string
  version: string
  description: string
  isActive: boolean
  hasServer: boolean
  hasClient: boolean
  serverChecksum: string | null
  clientChecksum: string | null
  // Plain block field-schema metadata (never executed) — carried through as the D1
  // row's own parsed value, not re-derived from raw text. definitionsChecksum is the
  // *original* checksum recorded at install time (needed to reproduce a valid
  // signature on restore); restore deliberately does not re-verify it against
  // blockDefinitions' content the way server/clientChecksum are re-verified against
  // their code, since only the parsed value survives into the backup, not the exact
  // original bytes the checksum was computed over — see the restore-path comment.
  // Low severity either way: this data is never executed, only rendered as inert
  // settings-panel text, so at worst a tampered backup.json shows misleading field
  // labels, not code execution.
  blockDefinitions: Record<string, unknown>[] | null
  definitionsChecksum: string | null
  publisherPublicKey: string
  signature: string
  serverCode: string | null
  clientBundle: string | null
}

// Email is the restore-matching key (accounts are global, not per-site — see
// user-provisioning.ts). Never includes 'super_admin': granting that is a deliberately
// separate, more-guarded flow (POST/DELETE /api/v1/users/:id/super-admin), and a backup
// file being user-editable before upload means it must never be a path to smuggling
// super-admin access onto a different site by re-uploading it there.
export interface BackupUserRole {
  email: string
  name: string
  role: 'admin' | 'editor' | 'author' | 'viewer' | 'member'
}

// Configuration only — deliberately does NOT include `subscriptions`. A subscription row
// copied onto a different deployment would look migrated but silently desync from
// reality: the payment provider's webhook is still configured to call the *original*
// deployment, so a cancellation/renewal on the new one would never be recorded. Moving a
// site with paying subscribers to a new deployment needs the operator to also repoint
// that webhook — no backup format can automate that part.
export interface BackupMembershipTier {
  name: string
  description: string | null
  price: number
  currency: string
  interval: 'month' | 'year' | 'one_time'
  features: string[]
  stripeProductId: string | null
  stripePriceId: string | null
  lsProductId: string | null
  lsVariantId: string | null
  paddleProductId: string | null
  isActive: boolean
}

export interface NuxFlowBackup {
  version: '1'
  exportedAt: string
  site: {
    name: string
    locale: string
    timezone: string
  }
  settings: Record<string, unknown>
  contentTypes: BackupContentType[]
  content: BackupContentItem[]
  taxonomies: BackupTaxonomy[]
  menus: BackupMenu[]
  forms: BackupForm[]
  media: BackupMediaItem[]
  themes: BackupTheme[]
  plugins: BackupDynamicPlugin[]
  users: BackupUserRole[]
  membershipTiers: BackupMembershipTier[]
}

// ── Backup format runtime validation ──────────────────────────────────────────
// A backup.json is user-editable before upload (unzip, edit, rezip — or just upload a
// raw .json), so the restore path must never trust `JSON.parse(...) as NuxFlowBackup`
// the way a same-process value could be. This schema is the actual enforcement of the
// "never restores super_admin" guarantee documented on BackupUserRole: buildBackup()
// filtering it out of a *real* export means nothing to an attacker who skips buildBackup()
// entirely and crafts the JSON by hand. Restricting `role` to this enum makes any such
// payload fail validation before it ever reaches applyBackup(), rather than relying on
// the update/insert logic downstream to remember to check it.
// Single source of truth for "roles a backup restore is allowed to grant" — shared by
// the Zod schema below (rejects an untrusted upload outright) and by the users-restore
// loop in applyBackup() itself (a second, redundant check — applyBackup() is also called
// from demo-import.post.ts and directly from tests, neither of which necessarily goes
// through parseBackupJson(), so the loop must not rely solely on the upload-time schema).
export const RESTORABLE_ROLES = ['admin', 'editor', 'author', 'viewer', 'member'] as const

const backupUserRoleSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  role: z.enum(RESTORABLE_ROLES),
})

const backupContentTypeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  singularName: z.string(),
  icon: z.string().nullable(),
  isBuiltIn: z.boolean(),
  hasRevisions: z.boolean(),
  hasComments: z.boolean(),
})

const backupContentItemSchema = z.object({
  typeSlug: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  visibility: z.string(),
  content: z.unknown(),
  excerpt: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  ogImage: z.string().nullable(),
  publishedAt: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  termSlugs: z.array(z.string()),
  locale: z.string().nullable(),
  sourceItemSlug: z.string().nullable(),
})

const backupTermSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentSlug: z.string().nullable(),
})

const backupTaxonomySchema = z.object({
  slug: z.string(),
  name: z.string(),
  isHierarchical: z.boolean(),
  terms: z.array(backupTermSchema),
})

const backupMenuSchema = z.object({
  name: z.string(),
  location: z.string().nullable(),
  items: z.array(z.unknown()),
})

const backupFormSchema = z.object({
  slug: z.string(),
  name: z.string(),
  fields: z.array(z.unknown()),
  notifications: z.unknown(),
  redirectUrl: z.string().nullable(),
  status: z.string(),
})

const backupMediaItemSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
  url: z.string(),
  zipPath: z.string().nullable(),
})

const backupThemeSchema = z.object({
  packageName: z.string(),
  name: z.string(),
  version: z.string(),
  isActive: z.boolean(),
  hasCss: z.boolean(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  css: z.string().nullable(),
  demo: z.string().nullable(),
})

const backupDynamicPluginSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  isActive: z.boolean(),
  hasServer: z.boolean(),
  hasClient: z.boolean(),
  serverChecksum: z.string().nullable(),
  clientChecksum: z.string().nullable(),
  blockDefinitions: z.array(z.record(z.string(), z.unknown())).nullable(),
  definitionsChecksum: z.string().nullable(),
  publisherPublicKey: z.string(),
  signature: z.string(),
  serverCode: z.string().nullable(),
  clientBundle: z.string().nullable(),
}).superRefine((data, ctx) => {
  // Mirrors the superRefine in server/api/v1/dynamic-plugins/index.post.ts's install-body
  // schema — without this, a backup.json (user-editable before upload) could carry a
  // serverCode/clientBundle with its checksum field left absent, which the restore loop's
  // checksum check below only runs "if checksum present" and otherwise silently skips,
  // while the corresponding signature check substitutes 'none' for the missing checksum —
  // exactly the value that placeholder was signed over for a plugin that legitimately had
  // no server/client artifact at all. That let unsigned code through under a signature that
  // never actually covered it. Rejecting the shape here closes that off at the schema level,
  // matching the fail-closed contract every other install path already enforces.
  if (data.serverCode && !data.serverChecksum) {
    ctx.addIssue({ code: 'custom', message: 'serverChecksum is required when serverCode is present', path: ['serverChecksum'] })
  }
  if (data.clientBundle && !data.clientChecksum) {
    ctx.addIssue({ code: 'custom', message: 'clientChecksum is required when clientBundle is present', path: ['clientChecksum'] })
  }
  if (data.blockDefinitions && !data.definitionsChecksum) {
    ctx.addIssue({ code: 'custom', message: 'definitionsChecksum is required when blockDefinitions is present', path: ['definitionsChecksum'] })
  }
})

const backupMembershipTierSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  currency: z.string(),
  interval: z.enum(['month', 'year', 'one_time']),
  features: z.array(z.string()),
  stripeProductId: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  lsProductId: z.string().nullable(),
  lsVariantId: z.string().nullable(),
  paddleProductId: z.string().nullable(),
  isActive: z.boolean(),
})

export const nuxFlowBackupSchema = z.object({
  version: z.literal('1'),
  exportedAt: z.string(),
  site: z.object({
    name: z.string(),
    locale: z.string(),
    timezone: z.string(),
  }),
  settings: z.record(z.string(), z.unknown()),
  contentTypes: z.array(backupContentTypeSchema),
  content: z.array(backupContentItemSchema),
  taxonomies: z.array(backupTaxonomySchema),
  menus: z.array(backupMenuSchema),
  forms: z.array(backupFormSchema),
  media: z.array(backupMediaItemSchema),
  themes: z.array(backupThemeSchema),
  plugins: z.array(backupDynamicPluginSchema),
  users: z.array(backupUserRoleSchema),
  membershipTiers: z.array(backupMembershipTierSchema),
}) satisfies z.ZodType<NuxFlowBackup>

// Parses and validates an uploaded backup.json against the schema above, throwing a
// standard 400 (not a raw ZodError) on anything malformed — the only path by which
// externally-supplied backup JSON should ever become a trusted `NuxFlowBackup` value.
export function parseBackupJson(raw: string): NuxFlowBackup {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw badRequest('Backup file is not valid JSON')
  }
  const result = nuxFlowBackupSchema.safeParse(json)
  if (!result.success) {
    throw badRequest(`Backup file failed validation: ${result.error.issues[0]?.message ?? 'invalid shape'}`)
  }
  return result.data
}

// Replaces all occurrences of old image URLs with new ones throughout the backup JSON.
// Image URLs can appear anywhere in nested TipTap content, form fields, or menu items,
// so a single serialize/rewrite/parse pass over the whole document is the only reliably
// correct approach. One combined regex replaces every URL in one string scan instead of
// N sequential replaceAll() passes (N = urlMap.size), which is what actually scales badly.
export function rewriteImageUrls(backup: NuxFlowBackup, urlMap: Map<string, string>): NuxFlowBackup {
  if (urlMap.size === 0) return backup
  const pattern = new RegExp(
    [...urlMap.keys()].map(url => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  )
  const json = JSON.stringify(backup).replace(pattern, oldUrl => urlMap.get(oldUrl) ?? oldUrl)
  return JSON.parse(json) as NuxFlowBackup
}

// ── Restore options and result shapes ─────────────────────────────────────────

export interface RestoreOptions {
  // 'site' is intentionally its own flag, separate from 'settings' — a theme's bundled
  // demo.json is also a NuxFlowBackup and always carries a placeholder `site` block (see
  // docs/development.md's demo.json example), but demo-import.post.ts never includes
  // 'site' in the `what` it passes to applyBackup(), so importing a theme's demo content
  // can never overwrite the live site's name/locale/timezone. Only the real restore route
  // (restore.post.ts) opts into 'site'.
  what: ('content' | 'settings' | 'menus' | 'taxonomies' | 'forms' | 'site' | 'themes' | 'plugins' | 'users' | 'membershipTiers')[]
  conflictMode: 'skip' | 'overwrite' | 'archive'
}

export interface RestoreResult {
  site: { updated: boolean }
  content: { created: number; updated: number; skipped: number }
  taxonomies: { created: number }
  terms: { created: number }
  menus: { created: number }
  forms: { created: number }
  settings: { updated: number }
  themes: { created: number; updated: number; skipped: number }
  plugins: { created: number; updated: number; skipped: number; rejected: number }
  users: { created: number; updated: number; skipped: number }
  membershipTiers: { created: number; updated: number; skipped: number }
}
