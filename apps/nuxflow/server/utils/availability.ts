import type { H3Event } from 'h3'
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { ulid } from 'ulid'
import { availabilityBlocks, availabilityFeeds, contentItems, sites } from '@nuxflow/db/schema'
import { useDb } from './db'
import { isSafeUrl, safeFetch } from './ssrf'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'
import { findPublishedPage, parseLocalePath } from './public-page'
import { checkContentAccess } from './content-access'
import { notFound, validationError } from './response'
import { chunk } from '../../shared/lib/array'
import { addIsoDays, isValidIsoDate, mergeRanges, parseIcalRanges } from '../../shared/lib/ical-import'

/**
 * Holiday lets: which nights a property (any content item, usually a page with the
 * Availability calendar block) can't be booked.
 *
 * - **Followed calendars** (`availability_feeds`): the iCal export links Airbnb, Booking.com,
 *   Vrbo… give each listing. Fetched hourly (and by "Sync now") through the SSRF guard; each
 *   sync replaces that calendar's nights. A failed sync keeps the nights it had.
 * - **Own blocks** (`availability_blocks` with no feed): direct bookings, owner stays,
 *   maintenance — added in the editor's Availability panel.
 * - **Export**: `/_nuxflow/availability-ics/<item id>?token=` lists the own blocks only (never
 *   what came from a booking site, or each site would echo the others' bookings back), for
 *   pasting into Airbnb and Booking.com so all of them stay in step. The token is an HMAC of
 *   the item, so the link works before the page is published and isn't guessable.
 *
 * Dates are nights: `start` is the first night, `end` the day the guests leave. A translation
 * shares its original's calendar.
 */

export const MAX_FEEDS_PER_ITEM = 10
export const MAX_OWN_BLOCKS_PER_ITEM = 500
/** How far ahead nights are kept (and shown). */
export const DAYS_AHEAD = 540
const MAX_ICS_BYTES = 2_000_000
const FETCH_TIMEOUT_MS = 15_000
/** Feeds synced per hourly run across every site; the rest wait an hour. */
const SYNC_BATCH = 60
const SYNC_CONCURRENCY = 6
/** A feed synced more recently than this is skipped by the hourly run. */
const RESYNC_AFTER_MS = 50 * 60_000

type Db = ReturnType<typeof useDb>

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

export function availabilityExportToken(siteId: string, itemId: string): Promise<string> {
  return hmacSha256Hex(linkSecret(), `availability-ics:${siteId}:${itemId}`)
}

export async function verifyAvailabilityExportToken(siteId: string, itemId: string, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false
  return constantTimeEqualHex(await availabilityExportToken(siteId, itemId), token)
}

/** "webcal://…" (what some sites hand out) → https; null for anything that isn't a safe https URL. */
export function normalizeFeedUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, 'https://')
  if (trimmed.length > 2000) return null
  let url: URL
  try {
    url = new URL(trimmed)
  }
  catch {
    return null
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return null
  return isSafeUrl(url.toString()) ? url.toString() : null
}

/** The item a calendar belongs to: this site's, and the original for a translation. */
async function ownerItem(db: Db, siteId: string, itemId: string) {
  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, itemId), eq(contentItems.siteId, siteId)),
    columns: { id: true, sourceItemId: true, title: true },
  })
  if (!item) throw notFound('This page was not found.')
  return item.sourceItemId
    ? (await db.query.contentItems.findFirst({
        where: and(eq(contentItems.id, item.sourceItemId), eq(contentItems.siteId, siteId)),
        columns: { id: true, sourceItemId: true, title: true },
      })) ?? item
    : item
}

/** What the editor's Availability panel shows. */
export async function getEditorAvailability(event: H3Event, siteId: string, itemId: string) {
  const db = useDb(event)
  const item = await ownerItem(db, siteId, itemId)
  const [feeds, blocks] = await Promise.all([
    db.query.availabilityFeeds.findMany({
      where: and(eq(availabilityFeeds.siteId, siteId), eq(availabilityFeeds.contentItemId, item.id)),
      orderBy: [asc(availabilityFeeds.createdAt)],
      columns: { id: true, url: true, label: true, lastSyncedAt: true, lastError: true, eventCount: true },
    }),
    db.query.availabilityBlocks.findMany({
      where: and(
        eq(availabilityBlocks.siteId, siteId),
        eq(availabilityBlocks.contentItemId, item.id),
        isNull(availabilityBlocks.feedId),
        gte(availabilityBlocks.endDate, addIsoDays(todayUtc(), -30)),
      ),
      orderBy: [asc(availabilityBlocks.startDate)],
      columns: { id: true, startDate: true, endDate: true, note: true },
    }),
  ])
  const token = await availabilityExportToken(siteId, item.id)
  const exportUrl = `${getRequestURL(event).origin}/_nuxflow/availability-ics/${item.id}?token=${token}`
  return { itemId: item.id, feeds, blocks, exportUrl }
}

export async function addFeed(event: H3Event, siteId: string, itemId: string, rawUrl: string, label: string) {
  const db = useDb(event)
  const item = await ownerItem(db, siteId, itemId)
  const url = normalizeFeedUrl(rawUrl)
  if (!url) throw validationError('Paste the calendar\'s https:// (or webcal://) export link.')
  const existing = await db.query.availabilityFeeds.findMany({
    where: and(eq(availabilityFeeds.siteId, siteId), eq(availabilityFeeds.contentItemId, item.id)),
    columns: { url: true },
  })
  if (existing.some(f => f.url === url)) throw validationError('This calendar is already followed.')
  if (existing.length >= MAX_FEEDS_PER_ITEM) throw validationError(`A page can follow at most ${MAX_FEEDS_PER_ITEM} calendars.`)
  const id = ulid()
  await db.insert(availabilityFeeds).values({ id, siteId, contentItemId: item.id, url, label: label.trim().slice(0, 60) })
  const feed = (await db.query.availabilityFeeds.findFirst({ where: and(eq(availabilityFeeds.id, id), eq(availabilityFeeds.siteId, siteId)) }))!
  return syncFeed(db, feed)
}

export async function removeFeed(event: H3Event, siteId: string, itemId: string, feedId: string) {
  const db = useDb(event)
  const item = await ownerItem(db, siteId, itemId)
  // The feed's nights go with it (FK cascade), but say so explicitly: D1 always enforces FKs,
  // the libSQL test driver only when asked.
  await db.delete(availabilityBlocks).where(and(eq(availabilityBlocks.siteId, siteId), eq(availabilityBlocks.feedId, feedId)))
  await db.delete(availabilityFeeds).where(and(
    eq(availabilityFeeds.id, feedId),
    eq(availabilityFeeds.siteId, siteId),
    eq(availabilityFeeds.contentItemId, item.id),
  ))
}

export async function addOwnBlock(event: H3Event, siteId: string, itemId: string, input: { start: string; end: string; note?: string }) {
  if (!isValidIsoDate(input.start) || !isValidIsoDate(input.end)) throw validationError('Choose the first night and the day they leave.')
  if (input.end <= input.start) throw validationError('The day they leave must be after the first night.')
  if (input.end > addIsoDays(todayUtc(), DAYS_AHEAD + 30)) throw validationError('That is too far ahead.')
  const db = useDb(event)
  const item = await ownerItem(db, siteId, itemId)
  const [{ n }] = await db.select({ n: count() }).from(availabilityBlocks).where(and(
    eq(availabilityBlocks.siteId, siteId),
    eq(availabilityBlocks.contentItemId, item.id),
    isNull(availabilityBlocks.feedId),
  )) as [{ n: number }]
  if (n >= MAX_OWN_BLOCKS_PER_ITEM) throw validationError('This page has too many blocked dates. Remove some old ones first.')
  const id = ulid()
  await db.insert(availabilityBlocks).values({
    id,
    siteId,
    contentItemId: item.id,
    feedId: null,
    startDate: input.start,
    endDate: input.end,
    note: (input.note ?? '').trim().slice(0, 200),
  })
  return { id }
}

export async function removeOwnBlock(event: H3Event, siteId: string, itemId: string, blockId: string) {
  const db = useDb(event)
  const item = await ownerItem(db, siteId, itemId)
  await db.delete(availabilityBlocks).where(and(
    eq(availabilityBlocks.id, blockId),
    eq(availabilityBlocks.siteId, siteId),
    eq(availabilityBlocks.contentItemId, item.id),
    isNull(availabilityBlocks.feedId),
  ))
}

/** Syncs every calendar this item follows ("Sync now"). */
export async function syncItemFeeds(event: H3Event, siteId: string, itemId: string) {
  const db = useDb(event)
  const item = await ownerItem(db, siteId, itemId)
  const feeds = await db.query.availabilityFeeds.findMany({
    where: and(eq(availabilityFeeds.siteId, siteId), eq(availabilityFeeds.contentItemId, item.id)),
  })
  return Promise.all(feeds.map(f => syncFeed(db, f)))
}

/** Reads the body, refusing anything over `max` bytes rather than buffering it. */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new Error('The calendar file is too large.')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new Error('The calendar file is too large.')
    }
    parts.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const p of parts) {
    all.set(p, offset)
    offset += p.byteLength
  }
  return new TextDecoder().decode(all)
}

/** Fetches a calendar file. Errors are plain sentences for the editor's panel. */
export async function fetchIcal(url: string, fetcher: typeof safeFetch = safeFetch): Promise<string> {
  let res: Response
  try {
    res = await fetcher(url, {
      headers: { 'Accept': 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'User-Agent': 'NuxFlow-Availability/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(/timeout|abort/i.test(msg) ? 'The calendar took too long to answer.' : 'The calendar couldn\'t be reached.', { cause: err })
  }
  if (!res.ok) throw new Error(`The calendar answered ${res.status}. Check the link is still the listing's export link.`)
  const text = await readCapped(res, MAX_ICS_BYTES)
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link isn\'t a calendar file (.ics).')
  return text
}

export interface FeedSyncResult {
  id: string
  label: string
  ok: boolean
  eventCount: number
  error: string | null
}

/**
 * Replaces one calendar's nights with what it says now (from yesterday to DAYS_AHEAD ahead).
 * On any failure the old nights stay and the error is kept for the panel.
 */
export async function syncFeed(db: Db, feed: typeof availabilityFeeds.$inferSelect, fetcher: typeof safeFetch = safeFetch): Promise<FeedSyncResult> {
  const now = new Date().toISOString()
  const scope = and(eq(availabilityFeeds.id, feed.id), eq(availabilityFeeds.siteId, feed.siteId))
  try {
    const text = await fetchIcal(feed.url, fetcher)
    const from = addIsoDays(todayUtc(), -1)
    const to = addIsoDays(todayUtc(), DAYS_AHEAD)
    const ranges = parseIcalRanges(text).filter(r => r.end > from && r.start <= to)
    const rows = ranges.map(r => ({
      id: ulid(),
      siteId: feed.siteId,
      contentItemId: feed.contentItemId,
      feedId: feed.id,
      startDate: r.start,
      endDate: r.end,
      note: r.summary,
    }))
    // Delete then insert in one batch, so a visitor never sees the calendar empty mid-sync.
    // Ten rows per insert keeps each statement under D1's 100 bound parameters.
    const statements: BatchItem<'sqlite'>[] = [
      db.delete(availabilityBlocks).where(and(eq(availabilityBlocks.siteId, feed.siteId), eq(availabilityBlocks.feedId, feed.id))),
      ...chunk(rows, 10).map(part => db.insert(availabilityBlocks).values(part)),
      db.update(availabilityFeeds).set({ lastSyncedAt: now, lastError: null, eventCount: rows.length }).where(scope),
    ]
    await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
    return { id: feed.id, label: feed.label, ok: true, eventCount: rows.length, error: null }
  }
  catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await db.update(availabilityFeeds).set({ lastSyncedAt: now, lastError: error }).where(scope)
    return { id: feed.id, label: feed.label, ok: false, eventCount: feed.eventCount, error }
  }
}

/**
 * Hourly, across every site: syncs the calendars that haven't been synced in the last
 * ~hour, oldest first. Suspended and moving sites are skipped.
 */
export async function syncDueFeeds(db: Db = useDb(), fetcher: typeof safeFetch = safeFetch) {
  const cutoff = new Date(Date.now() - RESYNC_AFTER_MS).toISOString()
  const closed = db.select({ id: sites.id }).from(sites).where(or(eq(sites.status, 'suspended'), isNotNull(sites.moveState)))
  const due = await db.query.availabilityFeeds.findMany({
    where: and(
      or(isNull(availabilityFeeds.lastSyncedAt), lt(availabilityFeeds.lastSyncedAt, cutoff)),
      notInArray(availabilityFeeds.siteId, closed),
    ),
    orderBy: [asc(availabilityFeeds.lastSyncedAt)],
    limit: SYNC_BATCH,
  })
  let ok = 0
  let failed = 0
  for (const group of chunk(due, SYNC_CONCURRENCY)) {
    const results = await Promise.all(group.map(f => syncFeed(db, f, fetcher)))
    for (const r of results) {
      if (r.ok) ok++
      else failed++
    }
  }
  return { synced: ok, failed }
}

/**
 * The booked nights of the published page at `path`, for the Availability calendar block:
 * merged ranges from today to DAYS_AHEAD ahead, no notes or sources (a guest only needs to
 * know a night is taken). 404 for a page the visitor can't see.
 */
export async function publicAvailability(event: H3Event, siteId: string, path: string) {
  const db = useDb(event)
  const slugPath = path.replace(/^\/+|\/+$/g, '') || 'home'
  const { locale, slug } = await parseLocalePath(db, siteId, slugPath)
  const page = await findPublishedPage(db, siteId, slug || 'home', locale)
  if (!page) throw notFound()
  const gate = await checkContentAccess(event, { id: page.id, sourceItemId: page.sourceItemId, visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate?.blocked) throw notFound()

  const today = todayUtc()
  const rows = await db.query.availabilityBlocks.findMany({
    where: and(
      eq(availabilityBlocks.siteId, siteId),
      inArray(availabilityBlocks.contentItemId, [page.sourceItemId ?? page.id]),
      gte(availabilityBlocks.endDate, today),
      lte(availabilityBlocks.startDate, addIsoDays(today, DAYS_AHEAD)),
    ),
    columns: { startDate: true, endDate: true },
  })
  return { today, booked: mergeRanges(rows.map(r => ({ start: r.startDate, end: r.endDate }))) }
}

/** The own blocks for the export calendar, from 30 days ago on. */
export async function exportBlocks(db: Db, siteId: string, itemId: string) {
  return db.query.availabilityBlocks.findMany({
    where: and(
      eq(availabilityBlocks.siteId, siteId),
      eq(availabilityBlocks.contentItemId, itemId),
      isNull(availabilityBlocks.feedId),
      gte(availabilityBlocks.endDate, addIsoDays(todayUtc(), -30)),
    ),
    orderBy: [asc(availabilityBlocks.startDate)],
    columns: { id: true, startDate: true, endDate: true, note: true, createdAt: true },
  })
}
