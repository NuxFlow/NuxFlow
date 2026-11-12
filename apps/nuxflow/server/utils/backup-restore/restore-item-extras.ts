// ── What hangs off a content item: product, holiday-let calendar, links ────────
// Runs after content, forms and tiers, on the items restoreContent() created or overwrote
// (`written`, by slug). Items it skipped keep everything they had.
import type { H3Event } from 'h3'
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import {
  availabilityBlocks, availabilityFeeds, contentItems, forms, membershipTiers, products, productVariants,
} from '@nuxflow/db/schema'
import type { Db } from '../db'
import { checkPlanLimit } from '../hosting-plans'
import { loadProduct } from '../products'
import { deleteShopFiles, uploadVariantFile, MAX_DOWNLOAD_BYTES } from '../shop-downloads'
import { normalizeFeedUrl, MAX_FEEDS_PER_ITEM, MAX_OWN_BLOCKS_PER_ITEM } from '../availability'
import { INTAKE_SETTING } from '../booking-intake'
import { httpErrorStatus } from '../errors'
import { isValidIsoDate } from '../../../shared/lib/ical-import'
import { chunk } from '../../../shared/lib/array'
import { noteLimit } from './plan-limits'
import { addRestoreWarning } from '../backup-types'
import type { WrittenItem } from './restore-content'
import type { BackupContentItem, BackupProduct, BackupProductVariant, NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

export async function restoreItemExtras(
  event: H3Event,
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
  written: Map<string, WrittenItem>,
): Promise<void> {
  if (!written.size) return
  for (const item of backup.content ?? []) {
    const target = written.get(item.slug)
    if (!target) continue
    await relinkItem(db, siteId, item, target.id, result)
    if (item.product) await restoreProduct(event, db, siteId, item, item.product, target.id, opts, result)
    // A new item has no calendar to clear; an overwritten one follows the backup, even to none.
    if (item.availability !== undefined && (item.availability || !target.created)) {
      await restoreAvailability(db, siteId, item, target.id, target.created, result)
    }
  }
}

// ── Links to a form and a tier ──────────────────────────────────────────────

/**
 * Points the item's intake form and tier gate at this site's form/tier of the same slug/name.
 * Only when the backup says what they were (older backups: settings stay as they are). A
 * tier that isn't here leaves the page gated on the old tier — closed to everyone rather
 * than open — and says so.
 */
async function relinkItem(db: Db, siteId: string, item: BackupContentItem, itemId: string, result: RestoreResult): Promise<void> {
  if (item.intakeFormSlug === undefined && item.accessTierName === undefined) return
  const settings: Record<string, unknown> = { ...(item.settings ?? {}) }
  let changed = false

  if (item.intakeFormSlug !== undefined) {
    const form = item.intakeFormSlug
      ? await db.query.forms.findFirst({ where: and(eq(forms.siteId, siteId), eq(forms.slug, item.intakeFormSlug)), columns: { id: true } })
      : undefined
    if (form) {
      if (settings[INTAKE_SETTING] !== form.id) {
        settings[INTAKE_SETTING] = form.id
        changed = true
      }
    }
    else if (INTAKE_SETTING in settings) {
      delete settings.intakeFormId
      changed = true
      if (item.intakeFormSlug) addRestoreWarning(result, `"${item.title}" had the intake form "${item.intakeFormSlug}", which isn't on this site — restore forms too, then choose it again.`)
    }
  }

  if (item.accessTierName) {
    const tier = await db.query.membershipTiers.findFirst({
      where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.name, item.accessTierName)),
      columns: { id: true },
    })
    if (tier) {
      if (settings.access !== `tier:${tier.id}`) {
        settings.access = `tier:${tier.id}`
        changed = true
      }
    }
    else {
      addRestoreWarning(result, `"${item.title}" is for the "${item.accessTierName}" membership, which isn't on this site, so nobody can open it — restore membership tiers too, or choose who can see it again.`)
    }
  }

  if (changed) {
    await db.update(contentItems).set({ settings })
      .where(and(eq(contentItems.id, itemId), eq(contentItems.siteId, siteId)))
  }
}

// ── Products ────────────────────────────────────────────────────────────────

/** Matches a backup variant to one the item already has: by SKU, else by its options. */
function variantKey(v: { sku: string | null; options: string[] }): string {
  return v.sku?.trim() ? `sku:${v.sku.trim().toLowerCase()}` : `opt:${JSON.stringify(v.options.map(o => o.toLowerCase()))}`
}

/**
 * Makes the item's product match the backup. Variants the item already has (same SKU or
 * options) keep their ids, so past orders' download links still work; new ones get new ids
 * (ids are global and a backup's may be in use). Downloads come from the .zip.
 */
async function restoreProduct(
  event: H3Event,
  db: Db,
  siteId: string,
  item: BackupContentItem,
  backupProduct: BackupProduct,
  itemId: string,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  const existing = await loadProduct(db, siteId, itemId)
  if (!existing.product && !(await checkPlanLimit(db, siteId, 'products')).allowed) {
    noteLimit(result, 'products')
    return
  }

  const now = new Date().toISOString()
  if (existing.product) {
    await db.update(products).set({ optionNames: backupProduct.optionNames, images: backupProduct.images, updatedAt: now })
      .where(and(eq(products.contentItemId, itemId), eq(products.siteId, siteId)))
  }
  else {
    await db.insert(products).values({ contentItemId: itemId, siteId, optionNames: backupProduct.optionNames, images: backupProduct.images })
  }

  const byKey = new Map(existing.variants.map(v => [variantKey(v), v]))
  const kept: string[] = []
  const files: { variantId: string; source: BackupProductVariant }[] = []
  for (const [sortOrder, v] of backupProduct.variants.entries()) {
    const fields = {
      sku: v.sku?.trim() || null,
      options: v.options,
      priceMinor: v.priceMinor,
      compareAtMinor: v.compareAtMinor,
      stock: v.stock,
      weightGrams: v.weightGrams,
      kind: v.kind,
      imageUrl: v.imageUrl?.trim() || null,
      isActive: v.isActive,
      sortOrder,
    }
    const match = byKey.get(variantKey(v))
    let id: string
    if (match && !kept.includes(match.id)) {
      id = match.id
      await db.update(productVariants).set({ ...fields, updatedAt: now })
        .where(and(eq(productVariants.id, id), eq(productVariants.siteId, siteId), eq(productVariants.contentItemId, itemId)))
    }
    else {
      id = ulid()
      await db.insert(productVariants).values({ id, siteId, contentItemId: itemId, ...fields })
    }
    kept.push(id)
    if (v.kind === 'digital' && v.fileName) files.push({ variantId: id, source: v })
  }

  const removed = existing.variants.filter(v => !kept.includes(v.id))
  if (removed.length) {
    await db.delete(productVariants).where(and(
      eq(productVariants.contentItemId, itemId),
      eq(productVariants.siteId, siteId),
      notInArray(productVariants.id, kept),
    ))
    await deleteShopFiles(event, removed.map(v => v.fileKey).filter((k): k is string => Boolean(k)))
  }
  result.products = { restored: (result.products?.restored ?? 0) + 1, files: result.products?.files ?? 0 }

  for (const { variantId, source } of files) {
    const path = source.fileZipPath
    const data = path && !path.includes('..') && !path.startsWith('/') && !path.startsWith('\\') ? opts.readFile?.(path) : undefined
    if (!data) {
      // Same site, same variant: the file it already has is still there.
      const hasFile = existing.variants.some(v => v.id === variantId && v.fileKey)
      if (!hasFile) addRestoreWarning(result, `The download for "${item.title}" wasn't in the backup — upload it again in the product's editor.`)
      continue
    }
    if (data.byteLength > MAX_DOWNLOAD_BYTES) continue
    try {
      await uploadVariantFile(event, variantId, { name: source.fileName!, data })
      result.products.files++
    }
    catch (err) {
      const status = httpErrorStatus(err)
      if (status === 403) noteLimit(result, 'storage')
      else if (status === 409) addRestoreWarning(result, 'Downloads weren\'t restored: this site has no file storage (the MEDIA_BUCKET binding).')
      else {
        console.error(`[restore] Restoring the download for "${item.title}" failed:`, err)
        addRestoreWarning(result, `The download for "${item.title}" couldn't be restored — upload it again in the product's editor.`)
      }
    }
  }
}

// ── Holiday-let calendars ───────────────────────────────────────────────────

/**
 * Replaces the item's followed calendars and own blocked nights with the backup's. The
 * followed calendars' nights come back at the next hourly sync (never synced = due).
 */
async function restoreAvailability(db: Db, siteId: string, item: BackupContentItem, itemId: string, created: boolean, result: RestoreResult): Promise<void> {
  const backupAvailability = item.availability
  const oldFeeds = await db.query.availabilityFeeds.findMany({
    where: and(eq(availabilityFeeds.siteId, siteId), eq(availabilityFeeds.contentItemId, itemId)),
    columns: { id: true },
  })
  // Feeds' nights first (D1 cascades them, the libSQL test driver only when asked).
  if (oldFeeds.length) {
    await db.delete(availabilityBlocks).where(and(eq(availabilityBlocks.siteId, siteId), inArray(availabilityBlocks.feedId, oldFeeds.map(f => f.id))))
    await db.delete(availabilityFeeds).where(and(eq(availabilityFeeds.siteId, siteId), eq(availabilityFeeds.contentItemId, itemId)))
  }
  await db.delete(availabilityBlocks).where(and(
    eq(availabilityBlocks.siteId, siteId),
    eq(availabilityBlocks.contentItemId, itemId),
    isNull(availabilityBlocks.feedId),
  ))
  if (!backupAvailability) return

  const urls = new Set<string>()
  for (const feed of backupAvailability.feeds) {
    const url = normalizeFeedUrl(feed.url)
    if (!url) {
      addRestoreWarning(result, `"${item.title}" followed a calendar whose link isn't valid, so it was left out.`)
      continue
    }
    if (urls.has(url) || urls.size >= MAX_FEEDS_PER_ITEM) continue
    urls.add(url)
    await db.insert(availabilityFeeds).values({ id: ulid(), siteId, contentItemId: itemId, url, label: feed.label.trim().slice(0, 60) })
  }

  const blocks = backupAvailability.blocks
    .filter(b => isValidIsoDate(b.start) && isValidIsoDate(b.end) && b.end > b.start)
    .slice(0, MAX_OWN_BLOCKS_PER_ITEM)
    .map(b => ({ id: ulid(), siteId, contentItemId: itemId, feedId: null, startDate: b.start, endDate: b.end, note: b.note.trim().slice(0, 200) }))
  // 7 columns a row: 10 rows stay under D1's 100 bound parameters.
  for (const rows of chunk(blocks, 10)) await db.insert(availabilityBlocks).values(rows)

  // The export link is signed with the item's id, so only a new item's link changes.
  if (created && blocks.length) {
    addRestoreWarning(result, `"${item.title}" has a new calendar export link — paste it into Airbnb and Booking.com again (editor → Availability).`)
  }
  result.availability = {
    feeds: (result.availability?.feeds ?? 0) + urls.size,
    blocks: (result.availability?.blocks ?? 0) + blocks.length,
  }
}
