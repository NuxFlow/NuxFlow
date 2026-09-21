// ── Export (build backup object) ──────────────────────────────────────────────
// Split out of backup.ts: this file owns buildBackup() and the private helpers it alone
// uses. See backup-types.ts for the NuxFlowBackup shape this produces, and
// backup-restore/ for the corresponding restore-side logic.

import type { H3Event } from 'h3'
import { useDb } from './db'
import {
  sites, siteSettings,
  contentTypes, contentItems,
  taxonomies, taxonomyTerms, contentTaxonomyTerms,
  menus, forms, media,
  themes, dynamicPlugins,
  userSiteRoles, membershipTiers,
} from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { SENSITIVE_SETTING_KEYS } from './settings'
import { decryptText } from './encryption'
import { getThemeCSS, getThemeDemo } from './cf-theme-kv'
import { getPluginServerCode, getPluginClientBundle } from './cf-plugin-kv'
import type {
  NuxFlowBackup, BackupTheme, BackupDynamicPlugin, BackupUserRole, BackupMembershipTier,
  BackupTaxonomy, BackupTerm, BackupContentItem,
} from './backup-types'

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
      columns: { slug: true, name: true, fields: true, notifications: true, redirectUrl: true, status: true },
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
