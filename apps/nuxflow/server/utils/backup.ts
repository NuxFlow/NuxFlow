import type { H3Event } from 'h3'
import { useDb } from './db'
import {
  sites, siteSettings,
  contentTypes, contentItems,
  taxonomies, taxonomyTerms, contentTaxonomyTerms,
  menus, forms, media,
} from '@nuxflow/db/schema'
import type { FormField, ConditionalLogic } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

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
}

// Replaces all occurrences of old image URLs with new ones throughout the backup JSON
export function rewriteImageUrls(backup: NuxFlowBackup, urlMap: Map<string, string>): NuxFlowBackup {
  if (urlMap.size === 0) return backup
  let json = JSON.stringify(backup)
  for (const [oldUrl, newUrl] of urlMap) {
    json = json.replaceAll(oldUrl, newUrl)
  }
  return JSON.parse(json) as NuxFlowBackup
}

// ── Export (build backup object) ──────────────────────────────────────────────

export async function buildBackup(event: H3Event, siteId: string): Promise<NuxFlowBackup> {
  const db = useDb(event)

  const [site, settingRows, ctRows, itemRows, taxRows, menuRows, formRows, mediaRows] = await Promise.all([
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
  ])

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

  for (const item of itemRows) {
    const assignments = await db.query.contentTaxonomyTerms.findMany({
      where: eq(contentTaxonomyTerms.contentItemId, item.id),
    })
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

  const settingsMap: Record<string, unknown> = {}
  for (const row of settingRows) settingsMap[row.key] = row.value

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
  }
}

// ── Restore options ───────────────────────────────────────────────────────────

export interface RestoreOptions {
  what: ('content' | 'settings' | 'menus' | 'taxonomies' | 'forms')[]
  conflictMode: 'skip' | 'overwrite' | 'archive'
}

export interface RestoreResult {
  content: { created: number; skipped: number }
  taxonomies: { created: number }
  terms: { created: number }
  menus: { created: number }
  forms: { created: number }
  settings: { updated: number }
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
    content: { created: 0, skipped: 0 },
    taxonomies: { created: 0 },
    terms: { created: 0 },
    menus: { created: 0 },
    forms: { created: 0 },
    settings: { updated: 0 },
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  if (opts.what.includes('settings') && backup.settings) {
    for (const [key, value] of Object.entries(backup.settings)) {
      const existing = await db.query.siteSettings.findFirst({
        where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
      })
      if (existing) {
        if (opts.conflictMode === 'overwrite') {
          await db.update(siteSettings).set({ value }).where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)))
          result.settings.updated++
        }
      } else {
        await db.insert(siteSettings).values({ id: ulid(), siteId, key, value })
        result.settings.updated++
      }
    }
  }

  // ── Taxonomies + terms ────────────────────────────────────────────────────
  // Build a termSlugPath -> termId map for content assignment later
  const termIdBySlugPath = new Map<string, string>()

  if (opts.what.includes('taxonomies') && backup.taxonomies) {
    for (const backupTax of backup.taxonomies) {
      let tax = await db.query.taxonomies.findFirst({
        where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, backupTax.slug)),
      })
      if (!tax) {
        const id = ulid()
        await db.insert(taxonomies).values({
          id, siteId, slug: backupTax.slug, name: backupTax.name, isHierarchical: backupTax.isHierarchical,
        })
        tax = { id, siteId, slug: backupTax.slug, name: backupTax.name, isHierarchical: backupTax.isHierarchical, createdAt: '' }
        result.taxonomies.created++
      }

      // Insert terms (two-pass for parent references)
      const termIdBySlug = new Map<string, string>()

      for (const backupTerm of backupTax.terms) {
        let term = await db.query.taxonomyTerms.findFirst({
          where: and(eq(taxonomyTerms.taxonomyId, tax.id), eq(taxonomyTerms.slug, backupTerm.slug)),
        })
        if (!term) {
          const id = ulid()
          await db.insert(taxonomyTerms).values({
            id,
            taxonomyId: tax.id,
            slug: backupTerm.slug,
            name: backupTerm.name,
            description: backupTerm.description,
            parentId: null, // set in second pass
          })
          term = { id, taxonomyId: tax.id, slug: backupTerm.slug, name: backupTerm.name, description: backupTerm.description, parentId: null, createdAt: '' }
          result.terms.created++
        }
        termIdBySlug.set(backupTerm.slug, term.id)
        termIdBySlugPath.set(`${backupTax.slug}/${backupTerm.slug}`, term.id)
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

    for (const backupItem of backup.content) {
      const typeId = typeIdBySlug.get(backupItem.typeSlug)
      if (!typeId) continue

      const existing = await db.query.contentItems.findFirst({
        where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, backupItem.slug)),
        columns: { id: true, title: true },
      })

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
            visibility: backupItem.visibility as 'public' | 'private' | 'password' | 'members',
            content: backupItem.content,
            excerpt: backupItem.excerpt,
            seoTitle: backupItem.seoTitle,
            seoDescription: backupItem.seoDescription,
            ogImage: backupItem.ogImage,
            publishedAt: backupItem.publishedAt,
            settings: backupItem.settings ?? undefined,
            locale: backupItem.locale || 'en',
          }).where(eq(contentItems.id, existing.id))
          result.content.created++
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
        visibility: backupItem.visibility as 'public' | 'private' | 'password' | 'members',
        content: backupItem.content,
        excerpt: backupItem.excerpt,
        seoTitle: backupItem.seoTitle,
        seoDescription: backupItem.seoDescription,
        ogImage: backupItem.ogImage,
        publishedAt: backupItem.publishedAt,
        settings: backupItem.settings ?? undefined,
        locale: backupItem.locale || 'en',
      })

      // Assign terms
      if (backupItem.termSlugs?.length > 0) {
        const termIds = backupItem.termSlugs
          .map(s => termIdBySlugPath.get(s))
          .filter((t): t is string => t !== undefined)
        if (termIds.length > 0) {
          await db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: id, termId })))
        }
      }

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
    for (const backupMenu of backup.menus) {
      const existing = await db.query.menus.findFirst({
        where: and(eq(menus.siteId, siteId), eq(menus.name, backupMenu.name)),
      })
      if (existing) {
        if (opts.conflictMode === 'archive') {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          await db.update(menus).set({
            name: `${existing.name} (Backup — ${timestamp})`,
            location: null, // clear header/footer location so the new menu can take over!
          }).where(and(eq(menus.siteId, siteId), eq(menus.name, backupMenu.name)))
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
    }
  }

  // ── Forms ─────────────────────────────────────────────────────────────────
  if (opts.what.includes('forms') && backup.forms) {
    for (const backupForm of backup.forms) {
      const existing = await db.query.forms.findFirst({
        where: and(eq(forms.siteId, siteId), eq(forms.slug, backupForm.slug)),
      })
      if (existing) {
        if (opts.conflictMode === 'archive') {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          await db.update(forms).set({
            slug: `${existing.slug}-backup-${timestamp}`,
            name: `${existing.name} (Backup — ${timestamp})`,
            status: 'closed',
          }).where(and(eq(forms.siteId, siteId), eq(forms.slug, backupForm.slug)))
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
    }
  }

  return result
}
