import type { H3Event } from 'h3'
import { z } from 'zod'
import { useDb } from './db'
import {
  sites, siteSettings,
  contentTypes, contentItems,
  taxonomies, taxonomyTerms, contentTaxonomyTerms,
  menus, forms, media,
  themes, dynamicPlugins, dynamicPluginTrust,
  userSiteRoles, membershipTiers,
} from '@nuxflow/db/schema'
import type { FormField, ConditionalLogic } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { saveSetting, SENSITIVE_SETTING_KEYS } from './settings'
import { clearBetterAuthCache, getOrCreateBetterAuth } from './better-auth'
import { decryptText } from './encryption'
import {
  getThemeCSS, putThemeCSS, getThemeDemo, putThemeDemo,
  getPluginServerCode, putPluginServerCode, getPluginClientBundle, putPluginClientBundle,
} from './cf-env'
import { verifyPluginSignature, computeSha256 } from './plugin-signing'
import { findOrCreateUserAccount } from './user-provisioning'

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
  logic: unknown[]
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
  logic: z.array(z.unknown()),
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

// ── Export (build backup object) ──────────────────────────────────────────────

export async function buildBackup(event: H3Event, siteId: string): Promise<NuxFlowBackup> {
  const db = useDb(event)

  const [site, settingRows, ctRows, itemRows, taxRows, menuRows, formRows, mediaRows, themeRows, pluginRows, roleRows, tierRows] = await Promise.all([
    db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { name: true, locale: true, timezone: true },
    }),
    db.query.siteSettings.findMany({ where: eq(siteSettings.siteId, siteId) }),
    db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId) }),
    db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId)),
      columns: {
        id: true, typeId: true, slug: true, title: true, status: true, visibility: true,
        content: true, excerpt: true, seoTitle: true, seoDescription: true, ogImage: true,
        publishedAt: true, settings: true, locale: true, sourceItemId: true,
      },
    }),
    db.query.taxonomies.findMany({ where: eq(taxonomies.siteId, siteId) }),
    db.query.menus.findMany({
      where: eq(menus.siteId, siteId),
      columns: { name: true, location: true, items: true },
    }),
    db.query.forms.findMany({
      where: eq(forms.siteId, siteId),
      columns: { slug: true, name: true, fields: true, logic: true, notifications: true, redirectUrl: true, status: true },
    }),
    db.query.media.findMany({
      where: eq(media.siteId, siteId),
      columns: { id: true, originalName: true, mimeType: true, size: true, width: true, height: true, url: true, altText: true, caption: true },
    }),
    db.query.themes.findMany({ where: eq(themes.siteId, siteId) }),
    db.query.dynamicPlugins.findMany({ where: eq(dynamicPlugins.siteId, siteId) }),
    db.query.userSiteRoles.findMany({
      where: eq(userSiteRoles.siteId, siteId),
      with: { user: { columns: { name: true, email: true } } },
    }),
    db.query.membershipTiers.findMany({ where: eq(membershipTiers.siteId, siteId) }),
  ])

  // Themes: D1 row plus its KV-only CSS/demo payload (see BackupTheme). getThemeCSS()
  // is reused here rather than a raw kv.get() so a legacy pre-versioning CSS key still
  // gets picked up, and the value comes back already sanitized.
  const backupThemes: BackupTheme[] = []
  for (const t of themeRows) {
    backupThemes.push({
      packageName: t.packageName,
      name: t.name,
      version: t.version,
      isActive: t.isActive,
      hasCss: t.hasCss,
      settings: t.settings ?? null,
      css: t.hasCss ? await getThemeCSS(event, siteId, t.id, t.cssVersion) : null,
      demo: await getThemeDemo(event, siteId, t.id),
    })
  }

  // Dynamic plugins: D1 row plus its KV-only server/client code (see BackupDynamicPlugin).
  const backupPlugins: BackupDynamicPlugin[] = []
  for (const p of pluginRows) {
    backupPlugins.push({
      pluginId: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      isActive: p.isActive,
      hasServer: p.hasServer,
      hasClient: p.hasClient,
      serverChecksum: p.serverChecksum,
      clientChecksum: p.clientChecksum,
      blockDefinitions: p.blockDefinitions,
      definitionsChecksum: p.definitionsChecksum,
      publisherPublicKey: p.publisherPublicKey,
      signature: p.signature,
      serverCode: p.hasServer ? await getPluginServerCode(event, siteId, p.id) : null,
      clientBundle: p.hasClient ? await getPluginClientBundle(event, siteId, p.id) : null,
    })
  }

  // Excludes super_admin — see the comment on BackupUserRole.
  const backupUsers: BackupUserRole[] = roleRows
    .filter((r): r is typeof r & { user: { name: string; email: string }; role: BackupUserRole['role'] } =>
      r.user !== null && r.role !== 'super_admin')
    .map(r => ({ email: r.user.email, name: r.user.name, role: r.role }))

  const backupTiers: BackupMembershipTier[] = tierRows.map(t => ({
    name: t.name,
    description: t.description,
    price: t.price,
    currency: t.currency,
    interval: t.interval,
    features: t.features,
    stripeProductId: t.stripeProductId,
    stripePriceId: t.stripePriceId,
    lsProductId: t.lsProductId,
    lsVariantId: t.lsVariantId,
    paddleProductId: t.paddleProductId,
    isActive: t.isActive,
  }))

  // Build type slug lookup
  const typeSlugById = new Map(ctRows.map(t => [t.id, t.slug]))

  // Build taxonomy + term structures
  const backupTaxonomies: BackupTaxonomy[] = []
  const termSlugById = new Map<string, string>() // termId -> "{taxSlug}/{termSlug}"

  for (const tax of taxRows) {
    const terms = await db.query.taxonomyTerms.findMany({
      where: eq(taxonomyTerms.taxonomyId, tax.id),
    })

    // Two-pass: first build id->slug map, then parentSlug
    const termById = new Map(terms.map(t => [t.id, t]))
    const backupTerms: BackupTerm[] = terms.map(t => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      parentSlug: t.parentId ? (termById.get(t.parentId)?.slug ?? null) : null,
    }))

    for (const t of terms) {
      termSlugById.set(t.id, `${tax.slug}/${t.slug}`)
    }

    backupTaxonomies.push({
      slug: tax.slug,
      name: tax.name,
      isHierarchical: tax.isHierarchical,
      terms: backupTerms,
    })
  }

  // Build content with term assignments
  const backupContent: BackupContentItem[] = []
  const slugById = new Map(itemRows.map(i => [i.id, i.slug]))

  const allAssignments = itemRows.length > 0
    ? await db.query.contentTaxonomyTerms.findMany({
        where: inArray(contentTaxonomyTerms.contentItemId, itemRows.map(i => i.id)),
      })
    : []
  const assignmentsByItemId = new Map<string, typeof allAssignments>()
  for (const a of allAssignments) {
    const list = assignmentsByItemId.get(a.contentItemId)
    if (list) list.push(a)
    else assignmentsByItemId.set(a.contentItemId, [a])
  }

  for (const item of itemRows) {
    const assignments = assignmentsByItemId.get(item.id) ?? []
    const termSlugs = assignments
      .map(a => termSlugById.get(a.termId))
      .filter((s): s is string => s !== undefined)

    backupContent.push({
      typeSlug: typeSlugById.get(item.typeId) ?? 'page',
      slug: item.slug,
      title: item.title,
      status: item.status,
      visibility: item.visibility,
      content: item.content,
      excerpt: item.excerpt,
      seoTitle: item.seoTitle,
      seoDescription: item.seoDescription,
      ogImage: item.ogImage,
      publishedAt: item.publishedAt,
      settings: item.settings,
      termSlugs,
      locale: item.locale || null,
      sourceItemSlug: item.sourceItemId ? (slugById.get(item.sourceItemId) ?? null) : null,
    })
  }

  // Sensitive settings are stored encrypted under this deployment's own betterAuthSecret
  // (see settings.ts). Exporting the raw ciphertext would make it undecryptable on any
  // other deployment (a different secret) or if this deployment's secret ever rotates —
  // restore would then silently treat that garbage as if it were the real plaintext
  // secret. Decrypt on export the same way resolveSetting() does on every normal read, so
  // the backup always carries the real plaintext and restore can re-encrypt it correctly
  // under whatever secret is active at import time.
  const rc = useRuntimeConfig()
  const settingsMap: Record<string, unknown> = {}
  for (const row of settingRows) {
    let val = row.value
    if (SENSITIVE_SETTING_KEYS.has(row.key) && typeof val === 'string') {
      try {
        val = await decryptText(val, rc.betterAuthSecret as string)
      } catch {
        // Stored before encryption was enforced — already plaintext, export as-is.
      }
    }
    settingsMap[row.key] = val
  }

  return {
    version: '1',
    exportedAt: new Date().toISOString(),
    site: { name: site?.name ?? '', locale: site?.locale ?? 'en', timezone: site?.timezone ?? 'UTC' },
    settings: settingsMap,
    contentTypes: ctRows.map(t => ({
      slug: t.slug, name: t.name, singularName: t.singularName,
      icon: t.icon, isBuiltIn: t.isBuiltIn, hasRevisions: t.hasRevisions, hasComments: t.hasComments,
    })),
    content: backupContent,
    taxonomies: backupTaxonomies,
    menus: menuRows.map(m => ({ name: m.name, location: m.location, items: m.items as unknown[] })),
    forms: formRows.map(f => ({
      slug: f.slug, name: f.name,
      fields: f.fields as unknown[],
      logic: f.logic as unknown[],
      notifications: f.notifications,
      redirectUrl: f.redirectUrl,
      status: f.status,
    })),
    media: mediaRows.map(m => ({
      id: m.id,
      originalName: m.originalName,
      mimeType: m.mimeType,
      size: m.size,
      width: m.width ?? null,
      height: m.height ?? null,
      altText: m.altText ?? null,
      caption: m.caption ?? null,
      url: m.url,
      zipPath: null as string | null,
    })),
    themes: backupThemes,
    plugins: backupPlugins,
    users: backupUsers,
    membershipTiers: backupTiers,
  }
}

// ── Restore options ───────────────────────────────────────────────────────────

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

// Replaces a content item's taxonomy-term assignments with the ones from the backup.
// Used for both freshly-inserted items and 'overwrite'-mode updates — the delete is a
// no-op for a brand-new id, but is what makes overwrite actually reapply the backup's
// termSlugs instead of leaving whatever assignments (or lack of them) already existed.
async function replaceContentTerms(
  db: ReturnType<typeof useDb>,
  itemId: string,
  termSlugs: string[] | undefined,
  termIdBySlugPath: Map<string, string>,
): Promise<void> {
  await db.delete(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, itemId))
  if (!termSlugs?.length) return
  const termIds = termSlugs
    .map(s => termIdBySlugPath.get(s))
    .filter((t): t is string => t !== undefined)
  if (termIds.length > 0) {
    await db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: itemId, termId })))
  }
}

// ── Restore (apply backup to a site) ─────────────────────────────────────────

export async function applyBackup(
  event: H3Event,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const db = useDb(event)
  const result: RestoreResult = {
    site: { updated: false },
    content: { created: 0, updated: 0, skipped: 0 },
    taxonomies: { created: 0 },
    terms: { created: 0 },
    menus: { created: 0 },
    forms: { created: 0 },
    settings: { updated: 0 },
    themes: { created: 0, updated: 0, skipped: 0 },
    plugins: { created: 0, updated: 0, skipped: 0, rejected: 0 },
    users: { created: 0, updated: 0, skipped: 0 },
    membershipTiers: { created: 0, updated: 0, skipped: 0 },
  }

  // ── Site metadata ────────────────────────────────────────────────────────
  // Mirrors what buildBackup() exports (name/locale/timezone — see the `site` field
  // above) back onto the target site's own row. Gated on its own 'site' flag rather
  // than always running or piggybacking on 'settings' (see the RestoreOptions comment).
  if (opts.what.includes('site') && backup.site) {
    await db.update(sites).set({
      name: backup.site.name,
      locale: backup.site.locale,
      timezone: backup.site.timezone,
      updatedAt: new Date().toISOString(),
    }).where(eq(sites.id, siteId))
    result.site.updated = true
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  // Routed through saveSetting() rather than a raw insert/update — that's the single
  // chokepoint that (a) encrypts sensitive keys under this deployment's own secret (the
  // backup carries plaintext, decrypted on export above), and (b) busts the 30s
  // per-isolate settings cache on write. Bypassing it (the previous behavior here) meant
  // a restored setting could keep serving its pre-restore cached value for up to 30s on
  // the isolate that served the restore. clearBetterAuthCache() below covers the same gap
  // for OAuth credentials specifically — Better Auth caches a built instance per Host for
  // 5 minutes, and restoring auth.google_client_id/auth.github_client_secret etc. would
  // otherwise silently keep using pre-restore credentials for up to 5 minutes post-restore.
  if (opts.what.includes('settings') && backup.settings) {
    let touchedAuthSettings = false
    for (const [key, value] of Object.entries(backup.settings)) {
      const existing = await db.query.siteSettings.findFirst({
        where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
        columns: { id: true },
      })
      if (existing && opts.conflictMode !== 'overwrite') continue

      await saveSetting(event, key, value)
      result.settings.updated++
      if (key.startsWith('auth.')) touchedAuthSettings = true
    }
    if (touchedAuthSettings) clearBetterAuthCache()
  }

  // ── Taxonomies + terms ────────────────────────────────────────────────────
  // Build a termSlugPath -> termId map for content assignment later
  const termIdBySlugPath = new Map<string, string>()

  if (opts.what.includes('taxonomies') && backup.taxonomies) {
    // One prefetch instead of one findFirst() per taxonomy — a backup with many
    // taxonomies previously meant one D1 round trip per taxonomy before any write.
    const taxSlugs = backup.taxonomies.map(t => t.slug)
    const existingTaxRows = taxSlugs.length > 0
      ? await db.query.taxonomies.findMany({
          where: and(eq(taxonomies.siteId, siteId), inArray(taxonomies.slug, taxSlugs)),
          columns: { id: true, slug: true },
        })
      : []
    const taxIdBySlug = new Map(existingTaxRows.map(t => [t.slug, t.id]))

    // Same for terms: one prefetch across every taxonomy that already exists, keyed by
    // "{taxonomyId}/{slug}" since a term's slug is only unique within its own taxonomy.
    // A taxonomy created fresh below can't have any pre-existing terms, so it needs no
    // entry here.
    const existingTaxIds = existingTaxRows.map(t => t.id)
    const existingTermRows = existingTaxIds.length > 0
      ? await db.query.taxonomyTerms.findMany({
          where: inArray(taxonomyTerms.taxonomyId, existingTaxIds),
          columns: { id: true, taxonomyId: true, slug: true },
        })
      : []
    const termIdByTaxAndSlug = new Map(existingTermRows.map(t => [`${t.taxonomyId}/${t.slug}`, t.id]))

    for (const backupTax of backup.taxonomies) {
      let taxId = taxIdBySlug.get(backupTax.slug)
      if (!taxId) {
        taxId = ulid()
        await db.insert(taxonomies).values({
          id: taxId, siteId, slug: backupTax.slug, name: backupTax.name, isHierarchical: backupTax.isHierarchical,
        })
        result.taxonomies.created++
        // A backup.json is user-editable and could (however unrealistically) contain a
        // duplicate taxonomy slug; recording the freshly-created id here means a second
        // entry for the same slug is treated as already-existing instead of attempting a
        // second insert with the same (siteId, slug).
        taxIdBySlug.set(backupTax.slug, taxId)
      }

      // Insert terms (two-pass for parent references)
      const termIdBySlug = new Map<string, string>()

      for (const backupTerm of backupTax.terms) {
        const key = `${taxId}/${backupTerm.slug}`
        let termId = termIdByTaxAndSlug.get(key)
        if (!termId) {
          termId = ulid()
          await db.insert(taxonomyTerms).values({
            id: termId,
            taxonomyId: taxId,
            slug: backupTerm.slug,
            name: backupTerm.name,
            description: backupTerm.description,
            parentId: null, // set in second pass
          })
          result.terms.created++
          termIdByTaxAndSlug.set(key, termId)
        }
        termIdBySlug.set(backupTerm.slug, termId)
        termIdBySlugPath.set(`${backupTax.slug}/${backupTerm.slug}`, termId)
      }

      // Second pass: wire parent IDs
      for (const backupTerm of backupTax.terms) {
        if (backupTerm.parentSlug) {
          const childId = termIdBySlug.get(backupTerm.slug)
          const parentId = termIdBySlug.get(backupTerm.parentSlug)
          if (childId && parentId) {
            await db.update(taxonomyTerms).set({ parentId }).where(eq(taxonomyTerms.id, childId))
          }
        }
      }
    }
  }

  // ── Content ───────────────────────────────────────────────────────────────
  if (opts.what.includes('content') && backup.content) {
    // Build type slug -> id map
    const typeIdBySlug = new Map<string, string>()
    const ctRows = await db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId) })
    for (const t of ctRows) typeIdBySlug.set(t.slug, t.id)

    // Create any non-built-in content types from backup
    for (const backupType of backup.contentTypes ?? []) {
      if (!typeIdBySlug.has(backupType.slug)) {
        const id = ulid()
        await db.insert(contentTypes).values({
          id, siteId,
          slug: backupType.slug, name: backupType.name, singularName: backupType.singularName,
          icon: backupType.icon, isBuiltIn: false, hasRevisions: backupType.hasRevisions,
          hasComments: backupType.hasComments,
        })
        typeIdBySlug.set(backupType.slug, id)
      }
    }

    const idBySlug = new Map<string, string>()

    // One prefetch instead of one findFirst() per backup item — a backup with a few
    // thousand items previously meant a few thousand sequential existence-check round
    // trips before any write even happened.
    const existingBySlug = new Map<string, { id: string; title: string }>()
    if (backup.content.length > 0) {
      const existingItems = await db.query.contentItems.findMany({
        where: and(eq(contentItems.siteId, siteId), inArray(contentItems.slug, backup.content.map(i => i.slug))),
        columns: { id: true, title: true, slug: true },
      })
      for (const item of existingItems) existingBySlug.set(item.slug, { id: item.id, title: item.title })
    }

    for (const backupItem of backup.content) {
      const typeId = typeIdBySlug.get(backupItem.typeSlug)
      if (!typeId) continue

      const existing = existingBySlug.get(backupItem.slug)

      if (existing) {
        idBySlug.set(backupItem.slug, existing.id)

        if (opts.conflictMode === 'archive') {
          // Smart Archiving: Rename existing conflicting page slug & title, mark as draft
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          await db.update(contentItems).set({
            slug: `${backupItem.slug}-backup-${timestamp}`,
            title: `${existing.title} (Backup — ${timestamp})`,
            status: 'draft',
          }).where(eq(contentItems.id, existing.id))
          // Proceed to insert the new page cleanly!
        } else if (opts.conflictMode === 'overwrite') {
          await db.update(contentItems).set({
            title: backupItem.title,
            status: backupItem.status as 'draft' | 'published' | 'scheduled' | 'archived' | 'review',
            // A pre-existing backup could in principle carry the now-removed 'password'
            // value (it was a legal enum member, even though nothing ever actually wrote
            // it) — fall back to 'members' rather than let an invalid literal through.
            visibility: (backupItem.visibility === 'public' || backupItem.visibility === 'private' || backupItem.visibility === 'members')
              ? backupItem.visibility
              : 'members',
            content: backupItem.content,
            excerpt: backupItem.excerpt,
            seoTitle: backupItem.seoTitle,
            seoDescription: backupItem.seoDescription,
            ogImage: backupItem.ogImage,
            publishedAt: backupItem.publishedAt,
            settings: backupItem.settings ?? undefined,
            locale: backupItem.locale || 'en',
          }).where(eq(contentItems.id, existing.id))
          // Reapply the backup's term assignments too — without this, overwriting an
          // existing item would update its fields but silently keep whatever
          // categories/tags it already had (or lacked), ignoring backupItem.termSlugs.
          await replaceContentTerms(db, existing.id, backupItem.termSlugs, termIdBySlugPath)
          result.content.updated++
          continue
        } else {
          result.content.skipped++
          continue
        }
      }

      const id = ulid()
      idBySlug.set(backupItem.slug, id)
      await db.insert(contentItems).values({
        id, siteId, typeId,
        slug: backupItem.slug,
        title: backupItem.title,
        status: backupItem.status as 'draft' | 'published' | 'scheduled' | 'archived' | 'review',
        visibility: (backupItem.visibility === 'public' || backupItem.visibility === 'private' || backupItem.visibility === 'members')
          ? backupItem.visibility
          : 'members',
        content: backupItem.content,
        excerpt: backupItem.excerpt,
        seoTitle: backupItem.seoTitle,
        seoDescription: backupItem.seoDescription,
        ogImage: backupItem.ogImage,
        publishedAt: backupItem.publishedAt,
        settings: backupItem.settings ?? undefined,
        locale: backupItem.locale || 'en',
      })

      await replaceContentTerms(db, id, backupItem.termSlugs, termIdBySlugPath)

      result.content.created++
    }

    // Second pass: wire translation linkages
    for (const backupItem of backup.content) {
      if (backupItem.sourceItemSlug) {
        const childId = idBySlug.get(backupItem.slug)
        const parentId = idBySlug.get(backupItem.sourceItemSlug)
        if (childId && parentId) {
          await db.update(contentItems)
            .set({ sourceItemId: parentId })
            .where(eq(contentItems.id, childId))
        }
      }
    }
  }

  // ── Menus ─────────────────────────────────────────────────────────────────
  if (opts.what.includes('menus') && backup.menus) {
    // One prefetch instead of one findFirst() per menu.
    const menuNames = backup.menus.map(m => m.name)
    const existingMenuRows = menuNames.length > 0
      ? await db.query.menus.findMany({
          where: and(eq(menus.siteId, siteId), inArray(menus.name, menuNames)),
          columns: { name: true },
        })
      : []
    const existingMenuNames = new Set(existingMenuRows.map(m => m.name))

    for (const backupMenu of backup.menus) {
      if (existingMenuNames.has(backupMenu.name)) {
        if (opts.conflictMode === 'archive') {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          await db.update(menus).set({
            name: `${backupMenu.name} (Backup — ${timestamp})`,
            location: null, // clear header/footer location so the new menu can take over!
          }).where(and(eq(menus.siteId, siteId), eq(menus.name, backupMenu.name)))
          // The renamed row no longer occupies `backupMenu.name` — clear it so a later
          // duplicate-named entry in the same (user-editable) backup.json inserts cleanly
          // instead of re-triggering this branch against a name that's already moved on.
          existingMenuNames.delete(backupMenu.name)
        } else {
          continue
        }
      }
      await db.insert(menus).values({
        id: ulid(), siteId,
        name: backupMenu.name,
        location: backupMenu.location,
        items: backupMenu.items,
      })
      result.menus.created++
      existingMenuNames.add(backupMenu.name)
    }
  }

  // ── Forms ─────────────────────────────────────────────────────────────────
  if (opts.what.includes('forms') && backup.forms) {
    // One prefetch instead of one findFirst() per form.
    const formSlugs = backup.forms.map(f => f.slug)
    const existingFormRows = formSlugs.length > 0
      ? await db.query.forms.findMany({
          where: and(eq(forms.siteId, siteId), inArray(forms.slug, formSlugs)),
          columns: { slug: true, name: true },
        })
      : []
    const formBySlug = new Map(existingFormRows.map(f => [f.slug, f]))

    for (const backupForm of backup.forms) {
      const existing = formBySlug.get(backupForm.slug)
      if (existing) {
        if (opts.conflictMode === 'archive') {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          await db.update(forms).set({
            slug: `${existing.slug}-backup-${timestamp}`,
            name: `${existing.name} (Backup — ${timestamp})`,
            status: 'closed',
          }).where(and(eq(forms.siteId, siteId), eq(forms.slug, backupForm.slug)))
          // The renamed row no longer occupies `backupForm.slug` — see the equivalent
          // comment in the menus section above for why this matters for duplicate keys
          // within the same backup.
          formBySlug.delete(backupForm.slug)
        } else {
          continue
        }
      }
      await db.insert(forms).values({
        id: ulid(), siteId,
        slug: backupForm.slug,
        name: backupForm.name,
        fields: backupForm.fields as FormField[],
        logic: backupForm.logic as ConditionalLogic[],
        notifications: backupForm.notifications as Record<string, unknown> | undefined,
        redirectUrl: backupForm.redirectUrl,
        status: backupForm.status as 'active' | 'draft' | 'closed',
      })
      result.forms.created++
      formBySlug.set(backupForm.slug, { slug: backupForm.slug, name: backupForm.name })
    }
  }

  // ── Themes ────────────────────────────────────────────────────────────────
  // Matched by packageName (the closest thing themes have to a natural slug — `id` is a
  // generated ulid, regenerated on insert here same as everywhere else in this file).
  // A restored theme is always inserted inactive, even in overwrite mode: silently
  // swapping the live theme's CSS out from under a running site is a bigger surprise than
  // leaving the admin to activate it deliberately from Admin → Themes afterward.
  if (opts.what.includes('themes') && backup.themes) {
    // One prefetch instead of one findFirst() per theme.
    const themePackageNames = backup.themes.map(t => t.packageName)
    const existingThemeRows = themePackageNames.length > 0
      ? await db.query.themes.findMany({
          where: and(eq(themes.siteId, siteId), inArray(themes.packageName, themePackageNames)),
          columns: { id: true, packageName: true },
        })
      : []
    const themeByPackageName = new Map(existingThemeRows.map(t => [t.packageName, t]))

    for (const backupTheme of backup.themes) {
      const existing = themeByPackageName.get(backupTheme.packageName)

      if (existing && opts.conflictMode === 'skip') {
        result.themes.skipped++
        continue
      }

      if (existing && opts.conflictMode === 'overwrite') {
        await db.update(themes).set({
          name: backupTheme.name,
          version: backupTheme.version,
          hasCss: backupTheme.hasCss,
          settings: backupTheme.settings ?? undefined,
        }).where(eq(themes.id, existing.id))
        if (backupTheme.hasCss && backupTheme.css) await putThemeCSS(event, siteId, existing.id, backupTheme.css)
        if (backupTheme.demo) await putThemeDemo(event, siteId, existing.id, backupTheme.demo)
        result.themes.updated++
        continue
      }

      // No conflict, or conflictMode === 'archive' (existing theme is left untouched —
      // themes don't carry the "current draft" ambiguity content/menus/forms do, so
      // there's nothing to rename, just a second inactive theme to pick from).
      const id = ulid()
      const packageName = existing
        ? `${backupTheme.packageName}-backup-${Date.now()}`
        : backupTheme.packageName
      await db.insert(themes).values({
        id, siteId,
        packageName,
        name: backupTheme.name,
        version: backupTheme.version,
        isActive: false,
        hasCss: backupTheme.hasCss,
        settings: backupTheme.settings ?? undefined,
      })
      if (backupTheme.hasCss && backupTheme.css) await putThemeCSS(event, siteId, id, backupTheme.css)
      if (backupTheme.demo) await putThemeDemo(event, siteId, id, backupTheme.demo)
      result.themes.created++
      // Only record a genuinely new packageName — a duplicate entry for an
      // already-`existing` packageName must keep matching it on a later iteration (in
      // 'archive' mode that existing row is deliberately left untouched, so it should
      // still count as a conflict every time, exactly like the original per-row query
      // would have found it again on every call).
      if (!existing) themeByPackageName.set(packageName, { id, packageName })
    }
  }

  // ── Dynamic plugins ──────────────────────────────────────────────────────────
  // Unlike every other backup section, dynamicPlugins.id is the publisher-assigned
  // manifest id — it's both the KV key segment and the primary key, so (a) it's the
  // natural restore-matching key and (b) there's no way to "archive" a duplicate: a
  // second row can't reuse the same id (primary key), and a different id would use a
  // different KV namespace entirely, i.e. not actually be a restore of this plugin. So
  // conflictMode 'archive' behaves like 'skip' here, and only 'overwrite' can touch an
  // existing install. Every restored plugin is re-verified (checksum + Ed25519 signature
  // + publisher-key trust pinning) exactly as server/api/v1/dynamic-plugins/index.post.ts
  // does on a fresh install — a backup.json is user-editable before upload, so nothing
  // about its embedded code is trusted until it re-proves the same signature.
  if (opts.what.includes('plugins') && backup.plugins) {
    for (const backupPlugin of backup.plugins) {
      const existing = await db.query.dynamicPlugins.findFirst({
        where: and(eq(dynamicPlugins.siteId, siteId), eq(dynamicPlugins.id, backupPlugin.pluginId)),
      })
      if (existing && opts.conflictMode !== 'overwrite') {
        result.plugins.skipped++
        continue
      }
      if (!backupPlugin.serverCode && !backupPlugin.clientBundle) {
        result.plugins.skipped++
        continue
      }

      // Fails closed: code/bundle present with no checksum to verify against is rejected,
      // not silently passed through — see the superRefine on backupDynamicPluginSchema above
      // for why a missing checksum here can't be trusted just because the signature "matches"
      // (the signature would have been computed over the 'none' placeholder instead).
      if (backupPlugin.serverCode) {
        if (!backupPlugin.serverChecksum) {
          result.plugins.rejected++
          continue
        }
        const actual = await computeSha256(backupPlugin.serverCode)
        if (actual !== backupPlugin.serverChecksum) {
          result.plugins.rejected++
          continue
        }
      }
      if (backupPlugin.clientBundle) {
        if (!backupPlugin.clientChecksum) {
          result.plugins.rejected++
          continue
        }
        const actual = await computeSha256(backupPlugin.clientBundle)
        if (actual !== backupPlugin.clientChecksum) {
          result.plugins.rejected++
          continue
        }
      }

      let signatureValid: boolean
      try {
        signatureValid = await verifyPluginSignature(backupPlugin.publisherPublicKey, {
          id: backupPlugin.pluginId,
          version: backupPlugin.version,
          serverChecksum: backupPlugin.serverChecksum ?? 'none',
          clientChecksum: backupPlugin.clientChecksum ?? 'none',
          definitionsChecksum: backupPlugin.definitionsChecksum ?? 'none',
        }, backupPlugin.signature)
      } catch {
        signatureValid = false
      }
      if (!signatureValid) {
        result.plugins.rejected++
        continue
      }

      const trust = await db.query.dynamicPluginTrust.findFirst({
        where: and(eq(dynamicPluginTrust.siteId, siteId), eq(dynamicPluginTrust.pluginId, backupPlugin.pluginId)),
      })
      if (trust && trust.publisherPublicKey !== backupPlugin.publisherPublicKey) {
        result.plugins.rejected++
        continue
      }

      // dynamicPlugins.id has no per-site scoping in its primary key (see the comment
      // above the loop) — a plugin id already installed on a DIFFERENT site can't also be
      // inserted here, that's a raw SQLITE_CONSTRAINT_PRIMARYKEY away. Checked only on the
      // insert path (not the update-existing path above, which is already this exact row).
      if (!existing) {
        const elsewhere = await db.query.dynamicPlugins.findFirst({
          where: eq(dynamicPlugins.id, backupPlugin.pluginId),
          columns: { id: true },
        })
        if (elsewhere) {
          result.plugins.skipped++
          continue
        }
      }

      if (backupPlugin.serverCode) await putPluginServerCode(event, siteId, backupPlugin.pluginId, backupPlugin.serverCode)
      if (backupPlugin.clientBundle) await putPluginClientBundle(event, siteId, backupPlugin.pluginId, backupPlugin.clientBundle)

      if (existing) {
        await db.update(dynamicPlugins).set({
          name: backupPlugin.name,
          version: backupPlugin.version,
          description: backupPlugin.description,
          hasServer: Boolean(backupPlugin.serverCode),
          hasClient: Boolean(backupPlugin.clientBundle),
          serverChecksum: backupPlugin.serverChecksum,
          clientChecksum: backupPlugin.clientChecksum,
          blockDefinitions: backupPlugin.blockDefinitions,
          definitionsChecksum: backupPlugin.definitionsChecksum,
          publisherPublicKey: backupPlugin.publisherPublicKey,
          signature: backupPlugin.signature,
        }).where(eq(dynamicPlugins.id, existing.id))
        result.plugins.updated++
      } else {
        await db.insert(dynamicPlugins).values({
          id: backupPlugin.pluginId,
          siteId,
          name: backupPlugin.name,
          version: backupPlugin.version,
          description: backupPlugin.description,
          isActive: false,
          hasServer: Boolean(backupPlugin.serverCode),
          hasClient: Boolean(backupPlugin.clientBundle),
          serverChecksum: backupPlugin.serverChecksum,
          clientChecksum: backupPlugin.clientChecksum,
          blockDefinitions: backupPlugin.blockDefinitions,
          definitionsChecksum: backupPlugin.definitionsChecksum,
          publisherPublicKey: backupPlugin.publisherPublicKey,
          signature: backupPlugin.signature,
        })
        result.plugins.created++
        if (!trust) {
          await db.insert(dynamicPluginTrust).values({
            id: ulid(), siteId, pluginId: backupPlugin.pluginId, publisherPublicKey: backupPlugin.publisherPublicKey,
          })
        }
      }
    }
  }

  // ── Users & roles ────────────────────────────────────────────────────────
  // Matched by email (the natural key — accounts are global, not per-site; see
  // user-provisioning.ts). Restoring onto a brand-new deployment means none of the
  // original site's users exist there yet, so this provisions a fresh account (same
  // temp-password + "set your password" email pattern as a normal invite) for anyone
  // not already found by email, then assigns them the backed-up role. Never restores
  // 'super_admin' — buildBackup() already excludes it (see BackupUserRole), so this can
  // only ever grant real roles, same restriction PATCH/POST /api/v1/users enforce.
  if (opts.what.includes('users') && backup.users) {
    // One prefetch of this site's existing roles (joined to email) instead of one
    // getUserSiteRole() findFirst() per backup user. findOrCreateUserAccount() below still
    // does its own per-user account lookup/creation — that's global account provisioning
    // shared with the invite flow (accounts have no siteId), not the per-site matching key
    // this prefetch targets, so it isn't something a single inArray() could replace.
    const existingRoleRows = await db.query.userSiteRoles.findMany({
      where: eq(userSiteRoles.siteId, siteId),
      with: { user: { columns: { email: true } } },
    })
    const roleByEmail = new Map<string, { role: string }>()
    for (const r of existingRoleRows) {
      if (r.user) roleByEmail.set(r.user.email, { role: r.role })
    }

    for (const backupUser of backup.users) {
      // Second, redundant check on top of parseBackupJson()'s schema: applyBackup() is
      // also called from demo-import.post.ts and directly from tests with a plain object
      // literal, neither of which necessarily went through that schema — this is the one
      // check guaranteed to run no matter how the caller obtained `backup`.
      if (!(RESTORABLE_ROLES as readonly string[]).includes(backupUser.role)) {
        result.users.skipped++
        continue
      }

      const { userId: targetUserId, isNewAccount } = await findOrCreateUserAccount(event, {
        name: backupUser.name,
        email: backupUser.email,
      })

      const existingRole = roleByEmail.get(backupUser.email)
      if (existingRole) {
        if (opts.conflictMode === 'overwrite' && existingRole.role !== 'super_admin') {
          await db.update(userSiteRoles).set({ role: backupUser.role })
            .where(and(eq(userSiteRoles.userId, targetUserId), eq(userSiteRoles.siteId, siteId)))
          result.users.updated++
          roleByEmail.set(backupUser.email, { role: backupUser.role })
        } else {
          result.users.skipped++
        }
      } else {
        await db.insert(userSiteRoles).values({ id: ulid(), userId: targetUserId, siteId, role: backupUser.role })
        result.users.created++
        // Handles a duplicate email within the same backup.json (hand-edited — a real
        // export can't produce one): the second entry now sees the role the first entry
        // just created instead of trying to insert a second row for the same
        // (userId, siteId) pair.
        roleByEmail.set(backupUser.email, { role: backupUser.role })
      }

      if (isNewAccount) {
        try {
          const auth = await getOrCreateBetterAuth(event)
          await auth.api.requestPasswordReset({ body: { email: backupUser.email, redirectTo: '/reset-password' } })
        } catch (err) {
          console.error('[restore] Failed to send set-password email:', err)
        }
      }
    }
  }

  // ── Membership tiers ─────────────────────────────────────────────────────
  // Matched by name. Deliberately does not touch `subscriptions` — see the comment on
  // BackupMembershipTier for why copying those rows would be actively misleading.
  if (opts.what.includes('membershipTiers') && backup.membershipTiers) {
    // One prefetch instead of one findFirst() per tier.
    const tierNames = backup.membershipTiers.map(t => t.name)
    const existingTierRows = tierNames.length > 0
      ? await db.query.membershipTiers.findMany({
          where: and(eq(membershipTiers.siteId, siteId), inArray(membershipTiers.name, tierNames)),
          columns: { id: true, name: true },
        })
      : []
    const tierByName = new Map(existingTierRows.map(t => [t.name, t]))

    for (const backupTier of backup.membershipTiers) {
      const existing = tierByName.get(backupTier.name)
      if (existing) {
        if (opts.conflictMode === 'overwrite') {
          await db.update(membershipTiers).set({
            description: backupTier.description,
            price: backupTier.price,
            currency: backupTier.currency,
            interval: backupTier.interval,
            features: backupTier.features,
            stripeProductId: backupTier.stripeProductId,
            stripePriceId: backupTier.stripePriceId,
            lsProductId: backupTier.lsProductId,
            lsVariantId: backupTier.lsVariantId,
            paddleProductId: backupTier.paddleProductId,
            isActive: backupTier.isActive,
          }).where(eq(membershipTiers.id, existing.id))
          result.membershipTiers.updated++
        } else {
          result.membershipTiers.skipped++
        }
      } else {
        const id = ulid()
        await db.insert(membershipTiers).values({
          id,
          siteId,
          name: backupTier.name,
          description: backupTier.description,
          price: backupTier.price,
          currency: backupTier.currency,
          interval: backupTier.interval,
          features: backupTier.features,
          stripeProductId: backupTier.stripeProductId,
          stripePriceId: backupTier.stripePriceId,
          lsProductId: backupTier.lsProductId,
          lsVariantId: backupTier.lsVariantId,
          paddleProductId: backupTier.paddleProductId,
          isActive: backupTier.isActive,
        })
        result.membershipTiers.created++
        // Duplicate tier name within the same backup.json (hand-edited): treat the second
        // entry as already-existing instead of attempting a second insert for the same
        // (siteId, name).
        tierByName.set(backupTier.name, { id, name: backupTier.name })
      }
    }
  }

  return result
}
