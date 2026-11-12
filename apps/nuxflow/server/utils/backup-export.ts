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
  themes, dynamicPlugins, pluginStorage,
  userSiteRoles, membershipTiers, redirects,
  products, productVariants, availabilityFeeds, availabilityBlocks, classPasses,
} from '@nuxflow/db/schema'
import { parseFieldDefs } from '../../shared/lib/custom-fields'
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { SENSITIVE_SETTING_KEYS, SERVER_MANAGED_SETTING_KEYS } from './settings'
import { SHOP_ENABLED_KEY } from './shop'
import { INTAKE_SETTING } from './booking-intake'
import { PUSH_KEY_SETTINGS } from '../../shared/lib/setting-groups'
import { getTaxonomyContentTypeSlugs } from './taxonomy'
import { decryptText } from './encryption'
import { getThemeCSS, getThemeDemo } from './cf-theme-kv'
import { getPluginServerCode, getPluginClientBundle } from './cf-plugin-kv'
import { parseCapabilitiesText } from './plugin-package'
import type {
  NuxFlowBackup, BackupTheme, BackupDynamicPlugin, BackupUserRole, BackupMembershipTier,
  BackupTaxonomy, BackupTerm, BackupContentItem, BackupProduct, BackupAvailability,
} from './backup-types'

// A plugin's settings minus its secret fields — those are encrypted under this deployment's
// key, so they couldn't be decrypted elsewhere anyway, and a backup is a plain file.
function nonSecretPluginSettings(capabilities: string | null, stored: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!stored) return null
  let fields
  try {
    fields = parseCapabilitiesText(capabilities).settings
  } catch {
    return null
  }
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.type !== 'secret' && stored[f.key] !== undefined) out[f.key] = stored[f.key]
  }
  return Object.keys(out).length ? out : null
}

export interface BuildBackupOptions {
  /**
   * Include passwords and API keys (SENSITIVE_SETTING_KEYS), decrypted. Off by default: a
   * backup is often kept or reused as a template, and a file holding live Stripe/email/AI
   * keys in plain text is a liability. Moving a site to another deployment is when to turn
   * it on.
   */
  includeSecrets?: boolean
}

export async function buildBackup(event: H3Event, siteId: string, options: BuildBackupOptions = {}): Promise<NuxFlowBackup> {
  const db = useDb(event)

  const [site, settingRows, ctRows, itemRows, taxRows, menuRows, formRows, mediaRows, themeRows, pluginRows, roleRows, tierRows, redirectRows, productRows, variantRows, feedRows, ownBlockRows, passRows] = await Promise.all([
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
        canonicalUrl: true, metaRobots: true, focusKeyword: true, allowComments: true,
        eventStartAt: true, eventEndAt: true, eventAllDay: true, eventLocation: true, eventUrl: true, eventRsvpEnabled: true, eventRsvpCapacity: true, eventRsvpClosesAt: true, eventRecurrence: true, eventPrice: true, eventCurrency: true, eventCancelHours: true, eventPassesAllowed: true, fields: true,
      },
    }),
    db.query.taxonomies.findMany({ where: eq(taxonomies.siteId, siteId) }),
    db.query.menus.findMany({
      where: eq(menus.siteId, siteId),
      columns: { name: true, location: true, items: true },
    }),
    db.query.forms.findMany({
      where: eq(forms.siteId, siteId),
      columns: { id: true, slug: true, name: true, fields: true, notifications: true, redirectUrl: true, status: true },
    }),
    db.query.media.findMany({
      where: eq(media.siteId, siteId),
      columns: { id: true, originalName: true, mimeType: true, size: true, width: true, height: true, url: true, altText: true, caption: true, metadata: true, focalX: true, focalY: true },
    }),
    db.query.themes.findMany({ where: eq(themes.siteId, siteId) }),
    db.query.dynamicPlugins.findMany({ where: eq(dynamicPlugins.siteId, siteId) }),
    db.query.userSiteRoles.findMany({
      where: eq(userSiteRoles.siteId, siteId),
      with: { user: { columns: { name: true, email: true } } },
    }),
    db.query.membershipTiers.findMany({ where: eq(membershipTiers.siteId, siteId) }),
    db.query.redirects.findMany({ where: eq(redirects.siteId, siteId), columns: { from: true, to: true, statusCode: true } }),
    db.query.products.findMany({ where: eq(products.siteId, siteId) }),
    db.query.productVariants.findMany({
      where: eq(productVariants.siteId, siteId),
      orderBy: [asc(productVariants.sortOrder), asc(productVariants.id)],
    }),
    db.query.availabilityFeeds.findMany({
      where: eq(availabilityFeeds.siteId, siteId),
      columns: { contentItemId: true, url: true, label: true },
    }),
    // Own blocks only: a followed calendar's nights come back with its next sync.
    db.query.availabilityBlocks.findMany({
      where: and(eq(availabilityBlocks.siteId, siteId), isNull(availabilityBlocks.feedId)),
      columns: { contentItemId: true, startDate: true, endDate: true, note: true },
      orderBy: [asc(availabilityBlocks.startDate)],
    }),
    db.query.classPasses.findMany({ where: eq(classPasses.siteId, siteId) }),
  ])

  // Themes: D1 row plus its KV-only CSS/demo payload (see BackupTheme). getThemeCSS()
  // is reused here rather than a raw kv.get() so it resolves the current versioned key
  // and the value comes back already sanitized.
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
      serverCode: p.hasServer ? await getPluginServerCode(event, siteId, p.id, p.serverChecksum) : null,
      clientBundle: p.hasClient ? await getPluginClientBundle(event, siteId, p.id, p.clientChecksum) : null,
      capabilities: p.capabilities,
      capabilitiesChecksum: p.capabilitiesChecksum,
      settings: nonSecretPluginSettings(p.capabilities, p.settingsValues ?? null),
      storage: await db.select({ key: pluginStorage.key, value: pluginStorage.value, expiresAt: pluginStorage.expiresAt })
        .from(pluginStorage)
        .where(and(eq(pluginStorage.siteId, siteId), eq(pluginStorage.pluginId, p.id), or(isNull(pluginStorage.expiresAt), gt(pluginStorage.expiresAt, sql`datetime('now')`)))),
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

  const typeSlugsByTaxonomy = await getTaxonomyContentTypeSlugs(db, siteId, taxRows.map(t => t.id))
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
      sortOrder: t.sortOrder,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      ogImage: t.ogImage,
    }))

    for (const t of terms) {
      termSlugById.set(t.id, `${tax.slug}/${t.slug}`)
    }

    backupTaxonomies.push({
      slug: tax.slug,
      name: tax.name,
      isHierarchical: tax.isHierarchical,
      description: tax.description,
      noindex: tax.noindex,
      contentTypes: typeSlugsByTaxonomy.get(tax.id) ?? [],
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

  // Products, availability and links to forms/tiers, keyed by content item.
  const formSlugById = new Map(formRows.map(f => [f.id, f.slug]))
  const tierNameById = new Map(tierRows.map(t => [t.id, t.name]))
  const productByItem = new Map<string, BackupProduct>()
  for (const p of productRows) {
    productByItem.set(p.contentItemId, { optionNames: p.optionNames, images: p.images, variants: [] })
  }
  for (const v of variantRows) {
    productByItem.get(v.contentItemId)?.variants.push({
      id: v.id,
      sku: v.sku,
      options: v.options,
      priceMinor: v.priceMinor,
      compareAtMinor: v.compareAtMinor,
      stock: v.stock,
      weightGrams: v.weightGrams,
      kind: v.kind,
      imageUrl: v.imageUrl,
      isActive: v.isActive,
      // The file itself is added to the .zip by the backup route, which fills in fileZipPath.
      fileName: v.fileKey ? v.fileName : null,
      fileSize: v.fileKey ? v.fileSize : null,
      fileZipPath: null,
    })
  }
  const availabilityByItem = new Map<string, BackupAvailability>()
  const availabilityFor = (itemId: string) => {
    let a = availabilityByItem.get(itemId)
    if (!a) availabilityByItem.set(itemId, a = { feeds: [], blocks: [] })
    return a
  }
  for (const f of feedRows) availabilityFor(f.contentItemId).feeds.push({ url: f.url, label: f.label })
  for (const b of ownBlockRows) availabilityFor(b.contentItemId).blocks.push({ start: b.startDate, end: b.endDate, note: b.note })

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
      canonicalUrl: item.canonicalUrl,
      metaRobots: item.metaRobots,
      focusKeyword: item.focusKeyword,
      allowComments: item.allowComments,
      eventStartAt: item.eventStartAt,
      eventEndAt: item.eventEndAt,
      eventAllDay: item.eventAllDay,
      eventLocation: item.eventLocation,
      eventUrl: item.eventUrl,
      eventRsvpEnabled: item.eventRsvpEnabled,
      eventRsvpCapacity: item.eventRsvpCapacity,
      eventRsvpClosesAt: item.eventRsvpClosesAt,
      eventRecurrence: item.eventRecurrence,
      eventPrice: item.eventPrice,
      eventCurrency: item.eventCurrency,
      eventCancelHours: item.eventCancelHours,
      eventPassesAllowed: item.eventPassesAllowed,
      fields: item.fields,
      ...itemLinks(item.settings, formSlugById, tierNameById),
      product: productByItem.get(item.id)?.variants.length ? productByItem.get(item.id)! : null,
      availability: availabilityByItem.get(item.id) ?? null,
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
  let shopEnabled = false
  for (const row of settingRows) {
    if (row.key === SHOP_ENABLED_KEY) shopEnabled = row.value === true || row.value === 'true'
    // Deployment-specific identifiers (the inbound email handle) never travel in a backup.
    if (SERVER_MANAGED_SETTING_KEYS.has(row.key)) continue
    // Without secrets, both push keys stay out: the public key alone would replace the
    // target's pair with half of one.
    if (!options.includeSecrets && (SENSITIVE_SETTING_KEYS.has(row.key) || (PUSH_KEY_SETTINGS as readonly string[]).includes(row.key))) continue
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
      fields: parseFieldDefs(t.schema),
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
      metadata: m.metadata ?? null,
      focalX: m.focalX ?? null,
      focalY: m.focalY ?? null,
    })),
    themes: backupThemes,
    plugins: backupPlugins,
    users: backupUsers,
    membershipTiers: backupTiers,
    redirects: redirectRows.map(r => ({ from: r.from, to: r.to, statusCode: r.statusCode })),
    classPasses: passRows.map(p => ({
      name: p.name,
      description: p.description,
      credits: p.credits,
      price: p.price,
      currency: p.currency,
      validDays: p.validDays,
      isActive: p.isActive,
    })),
    shop: { enabled: shopEnabled },
  }
}

// An item's links to a form (intake form) and a membership tier (access), by slug and name:
// the ids in `settings` mean nothing once restored, where every row gets a new one.
function itemLinks(
  settings: Record<string, unknown> | null,
  formSlugById: Map<string, string>,
  tierNameById: Map<string, string>,
): Pick<BackupContentItem, 'intakeFormSlug' | 'accessTierName'> {
  const out: Pick<BackupContentItem, 'intakeFormSlug' | 'accessTierName'> = {}
  const formId = settings?.[INTAKE_SETTING]
  if (typeof formId === 'string' && formId) out.intakeFormSlug = formSlugById.get(formId) ?? null
  const access = settings?.access
  if (typeof access === 'string' && access.startsWith('tier:')) out.accessTierName = tierNameById.get(access.slice(5)) ?? null
  return out
}
