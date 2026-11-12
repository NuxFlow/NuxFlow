import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, galleryPicks, media } from '@nuxflow/db/schema'
import { useDb } from './db'
import { sha256Hex } from './buffer'
import { galleryImageUrls, resolvePublicGallery } from './gallery-download'
import { notifySiteRole } from './notify'
import { notFound } from './response'
import type { PickerSummary } from '../../shared/lib/editor-types'

/**
 * Client proofing: a Gallery block with "Let clients pick favourites" (usually on a
 * password page) lets each person heart photos and send their picks. No account: the
 * browser keeps a random token (stored here as its SHA-256), so a couple can each pick on
 * their own, and the same person picking again on another visit edits their own list.
 * Picks are kept by photo URL, so reordering the gallery doesn't change them. The team sees
 * them in the page's editor (Client picks), with file names to copy into Lightroom.
 */

export const MAX_PICKS = 2000
const TOKEN = /^[\w-]{24,128}$/

export function isPickerToken(token: string): boolean {
  return TOKEN.test(token)
}

async function own(event: H3Event, siteId: string, path: string, blockId: string, token: string) {
  const { page, block } = await resolvePublicGallery(event, siteId, path, blockId, 'allowFavourites')
  const tokenHash = await sha256Hex(token)
  const scope = and(
    eq(galleryPicks.siteId, siteId),
    eq(galleryPicks.contentItemId, page.id),
    eq(galleryPicks.blockId, blockId),
    eq(galleryPicks.pickerTokenHash, tokenHash),
  )
  return { page, block, tokenHash, scope }
}

/** A visitor's own picks, to put their hearts back on another visit or device. */
export async function getOwnPicks(event: H3Event, siteId: string, path: string, blockId: string, token: string) {
  const { scope } = await own(event, siteId, path, blockId, token)
  const row = await useDb(event).query.galleryPicks.findFirst({ where: scope, columns: { pickerName: true, photos: true, note: true, submittedAt: true } })
  return row ?? null
}

export interface SavePicksInput {
  path: string
  block: string
  token: string
  name: string
  photos: string[]
  note?: string
  /** "Send my picks": the team is told, once per change. */
  submit?: boolean
}

/**
 * Saves a visitor's picks (only photos actually in that gallery are kept) and, on "Send",
 * tells the site's editors — unless what was sent hasn't changed since the last send.
 */
export async function savePicks(event: H3Event, siteId: string, input: SavePicksInput): Promise<{ count: number; submitted: boolean }> {
  const db = useDb(event)
  const { page, block, tokenHash, scope } = await own(event, siteId, input.path, input.block, input.token)
  const inGallery = new Set(galleryImageUrls(block))
  const photos = [...new Set(input.photos)].filter(u => inGallery.has(u)).slice(0, MAX_PICKS)
  const now = new Date().toISOString()
  const name = input.name.trim().slice(0, 80)
  const note = input.note?.trim().slice(0, 2000) || null

  const existing = await db.query.galleryPicks.findFirst({ where: scope })
  const changedSinceSent = !existing?.submittedAt
    || JSON.stringify(existing.photos) !== JSON.stringify(photos)
    || (existing.note ?? null) !== note
  const submittedAt = input.submit ? now : existing?.submittedAt ?? null

  if (existing) {
    await db.update(galleryPicks).set({ pickerName: name, photos, note, submittedAt, updatedAt: now }).where(and(scope, eq(galleryPicks.id, existing.id)))
  }
  else {
    await db.insert(galleryPicks).values({
      id: ulid(), siteId, contentItemId: page.id, blockId: input.block, pickerTokenHash: tokenHash,
      pickerName: name, photos, note, submittedAt, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [galleryPicks.contentItemId, galleryPicks.blockId, galleryPicks.pickerTokenHash],
      set: { pickerName: name, photos, note, submittedAt, updatedAt: now },
    })
  }

  if (input.submit && changedSinceSent) {
    await notifySiteRole(event, {
      siteId,
      minRole: 'editor',
      type: 'gallery.picks',
      title: `${name} picked ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`,
      body: `On "${page.title}".${note ? ` Note: ${note.slice(0, 200)}` : ''}`,
      data: { contentItemId: page.id },
      pushUrl: `/admin/content/${page.id}`,
      actionLabel: 'See the picks',
      sendEmailNotification: true,
    }).catch(err => console.error('[gallery-picks] Notification failed:', err))
  }
  return { count: photos.length, submitted: Boolean(input.submit) }
}

export type { PickerSummary }

/** Everyone's picks on a page, for its editor — with each photo's original file name. */
export async function listPicksForItem(event: H3Event, siteId: string, itemId: string): Promise<PickerSummary[]> {
  const db = useDb(event)
  const item = await db.query.contentItems.findFirst({ where: and(eq(contentItems.id, itemId), eq(contentItems.siteId, siteId)), columns: { id: true } })
  if (!item) throw notFound('Not found')
  const rows = await db.query.galleryPicks.findMany({
    where: and(eq(galleryPicks.siteId, siteId), eq(galleryPicks.contentItemId, itemId)),
  })
  const urls = [...new Set(rows.flatMap(r => r.photos))].filter(u => !u.startsWith('data:'))
  const names = new Map<string, string>()
  for (let i = 0; i < urls.length; i += 90) {
    const found = await db.select({ url: media.url, originalName: media.originalName }).from(media)
      .where(and(eq(media.siteId, siteId), inArray(media.url, urls.slice(i, i + 90))))
    for (const f of found) names.set(f.url, f.originalName)
  }
  const fileName = (url: string) => names.get(url) ?? decodeURIComponent(url.split('?')[0]!.split('/').pop() || 'photo')
  return rows
    .sort((a, b) => (b.updatedAt).localeCompare(a.updatedAt))
    .map(r => ({
      id: r.id,
      blockId: r.blockId,
      name: r.pickerName,
      note: r.note,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
      photos: r.photos.map(url => ({ url, fileName: fileName(url) })),
    }))
}

/** Clears one person's picks (the editor's "Remove"). */
export async function deletePicks(event: H3Event, siteId: string, itemId: string, pickId: string): Promise<void> {
  await useDb(event).delete(galleryPicks).where(and(eq(galleryPicks.siteId, siteId), eq(galleryPicks.contentItemId, itemId), eq(galleryPicks.id, pickId)))
}
