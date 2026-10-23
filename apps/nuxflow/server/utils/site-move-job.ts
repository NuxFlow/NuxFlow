import type { H3Event } from 'h3'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { auditLogs, siteMoves, users } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { getPrimarySite } from './site-info'
import { findSite, pushPlansToPools } from './pool-sites'
import { syncSiteDirectory } from './site-directory'
import { poolAdminStub } from './pools'
import { CATCH_UP_TABLES, moveStore, moveTables, type FileCursor, type KvCursor, type MoveStore } from './site-move'
import { poolBindingName } from '../../shared/lib/pool-id'

/**
 * Moving a site to another pool (or between a pool and the control plane), driven one
 * step at a time by Super Admin → Sites, like the WordPress import — a whole move in one
 * request would run into Workers' time and query limits. The data side is site-move.ts.
 *
 *   locking   The site is locked (`outgoing`): visitors see the maintenance page and
 *             changes are refused. Copying waits LOCK_SETTLE_MS, until every Worker has
 *             noticed (sites are cached for 30 s per isolate).
 *   copying   Users it refers to, then every table in foreign-key order, then KV, then
 *             the links between rows of one table. The new copy is `incoming`: served
 *             nowhere yet.
 *   checking  Mail and logs that arrived meanwhile are copied too; then the number of
 *             rows in every table must match on both sides.
 *   switching The new copy goes live and the router is told; the old copy is `moved`.
 *   cleaning  After CLEANUP_DELAY_MS (the router caches addresses for a minute) the old
 *             copy's rows and KV keys are removed. Media and email files are in the
 *             shared R2 bucket, so they stay where they are.
 *
 * Until the switch, Cancel removes the new copy and unlocks the site.
 */

export type SiteMove = typeof siteMoves.$inferSelect
export type MovePhase = 'locking' | 'copying' | 'checking' | 'switching' | 'cleaning' | 'done' | 'failed' | 'cancelled'

export const LOCK_SETTLE_MS = 35_000
export const CLEANUP_DELAY_MS = 90_000
/** How long one step may keep copying before it answers the page. */
const STEP_BUDGET_MS = 12_000
const LEASE_MS = 3 * 60_000
const KV_GET_BATCH = 5
const CATCH_UP_SLACK_MS = 60_000
/** Times the files are gone over again before a move whose file totals still differ fails. */
const MAX_FILE_ROUNDS = 3

interface CopyCursor {
  stage: 'users' | 'rows' | 'kv' | 'files' | 'links' | 'catchup'
  table?: number
  offset?: number
  kv?: KvCursor | null
  link?: number
  /** Rows per table left out on purpose (see importRows). */
  dropped?: Record<string, number>
  /** Files (only when the buckets differ): the page being copied and how far into it. */
  files?: FileCursor | null
  fileIndex?: number
  /** How many times the files have been gone over again because the totals differed. */
  fileRounds?: number
}

export interface StepResult {
  move: SiteMove
  /** Another step is needed — at once, or after `waitMs`. */
  more: boolean
  waitMs?: number
  /** What the step did, for the progress line. */
  message: string
}

const where = (move: Pick<SiteMove, 'fromPool' | 'toPool'>) => ({ from: move.fromPool, to: move.toPool })

function sides(event: H3Event, move: SiteMove): { source: MoveStore; target: MoveStore } {
  const { from, to } = where(move)
  return { source: moveStore(event, from), target: moveStore(event, to) }
}

/** `datetime('now')`'s format, so it compares with the rows' created_at. */
function sqlTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

async function save(db: Db, id: string, values: Partial<SiteMove>): Promise<SiteMove> {
  const [row] = await db.update(siteMoves).set({ ...values, updatedAt: sql`(datetime('now'))` }).where(eq(siteMoves.id, id)).returning()
  return row!
}

export async function getSiteMove(db: Db, id: string): Promise<SiteMove> {
  const [move] = await db.select().from(siteMoves).where(eq(siteMoves.id, id)).limit(1)
  if (!move) throw notFound('Move not found')
  return move
}

/** Recent moves, newest first, for Super Admin → Sites. */
export async function listSiteMoves(db: Db): Promise<SiteMove[]> {
  return db.select().from(siteMoves).orderBy(desc(siteMoves.createdAt)).limit(20)
}

/**
 * Whether the destination keeps files in a different bucket: the source writes a probe
 * object, and if the destination can't see it, they're different. Copying files within one
 * bucket and then deleting the "old" ones would delete the only copy.
 */
async function filesNeedCopying(source: MoveStore, target: MoveStore): Promise<boolean> {
  const key = `_nuxflow/move-probe/${ulid()}`
  // No bucket on the source side: there are no files to copy.
  if (!(await source.probeWrite(key))) return false
  try {
    const seen = await target.probeSees(key)
    if (seen === 'no-bucket') throw conflict('The destination has no file storage (MEDIA_BUCKET), so this site\'s files couldn\'t go with it.')
    return seen === 'no'
  }
  finally {
    await source.probeDelete(key)
  }
}

/** Starts moving a site: checks both sides, then locks it. */
export async function startSiteMove(event: H3Event, input: { siteId: string; toPool: string | null }, actorUserId: string): Promise<SiteMove> {
  const db = useDb(event)
  const site = await findSite(event, input.siteId)
  if (!site) throw notFound('Site not found')
  const fromPool = site.poolId
  const toPool = input.toPool
  if (fromPool === toPool) throw conflict(toPool ? `The site is already in pool "${toPool}".` : 'The site is already on the control panel.')
  if (toPool && !poolAdminStub(event, toPool)) throw validationError(`There's no pool "${toPool}" connected to this control panel.`)
  const primary = await getPrimarySite(event)
  if (primary?.id === site.id) throw conflict('The platform\'s own main site can\'t be moved.')

  const source = moveStore(event, fromPool)
  const target = moveStore(event, toPool)
  const here = await source.inspect(site.id)
  if (!here.present) throw notFound('Site not found')
  if (here.isPrimary) throw conflict('The platform\'s own main site can\'t be moved.')
  if (here.moveState) throw conflict('This site is already being moved.')

  const there = await target.inspect(site.id)
  if (there.present && there.moveState !== 'incoming' && there.moveState !== 'moved') {
    throw conflict('The destination already has this site.')
  }
  const taken = await target.takenHosts(site.id, [here.domain!, ...here.aliases])
  if (taken.length) throw conflict(`Another site at the destination already uses ${taken.join(', ')}.`)

  // Same R2 bucket on both sides (the usual case: pools share one), or not (a pool with its
  // own, or an EU pool)? Found by a test write, never assumed from config.
  const copyFiles = await filesNeedCopying(source, target)
  if (copyFiles) {
    const absolute = await source.absoluteMediaUrls(site.id)
    if (absolute) {
      throw conflict(`${absolute} of this site's media files are linked by the old storage's public address, so they would break in a pool with its own storage. Set the site's media to be served by NuxFlow (no public R2 address), or move it to a pool that shares storage.`)
    }
  }

  // A copy left over from an earlier move that didn't finish.
  if (there.present) {
    if (copyFiles) await target.purgeFiles(site.id)
    await target.purge(site.id)
  }
  // The site keeps its plan: the destination pool needs the plans first.
  if (toPool) await pushPlansToPools(event, [poolBindingName(toPool)])

  let move: SiteMove
  try {
    const id = ulid()
    await db.insert(siteMoves).values({
      id,
      movedSiteId: site.id,
      siteName: site.name,
      siteDomain: site.domain,
      fromPool,
      toPool,
      phase: 'locking',
      copyFiles,
      startedBy: actorUserId,
    })
    move = await getSiteMove(db, id)
  }
  catch {
    throw conflict('This site is already being moved.')
  }

  if (!(await source.setMoveState(site.id, 'outgoing', null))) {
    await save(db, move.id, { phase: 'cancelled', error: 'The site changed before it could be locked.' })
    throw conflict('The site changed before it could be locked. Try again.')
  }
  move = await save(db, move.id, { lockedAt: new Date().toISOString() })
  await logMove(db, move, actorUserId, 'start')
  return move
}

/** Claims the move for one step, so two tabs never run the same step. Null when another request has it. */
async function claim(db: Db, id: string): Promise<SiteMove | null> {
  const now = new Date()
  const [move] = await db.update(siteMoves)
    .set({ lockedUntil: new Date(now.getTime() + LEASE_MS).toISOString() })
    .where(and(eq(siteMoves.id, id), or(isNull(siteMoves.lockedUntil), lt(siteMoves.lockedUntil, now.toISOString()))))
    .returning()
  return move ?? null
}

/** Does the next piece of work. Errors are recorded on the move, which can be tried again. */
export async function stepSiteMove(event: H3Event, id: string): Promise<StepResult> {
  const db = useDb(event)
  const claimed = await claim(db, id)
  if (!claimed) return { move: await getSiteMove(db, id), more: true, waitMs: 2000, message: 'Another window is working on this move.' }
  try {
    const result = await runStep(event, db, claimed)
    const move = await save(db, id, { error: null, ...result.changes, lockedUntil: null })
    return { move, more: !['done', 'failed', 'cancelled'].includes(move.phase), waitMs: result.waitMs, message: result.message }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[site-move] ${claimed.id} (${claimed.phase}) failed:`, err)
    const move = await save(db, id, { error: message, lockedUntil: null })
    return { move, more: false, message }
  }
}

interface StepChanges { changes: Partial<SiteMove>; message: string; waitMs?: number }

async function runStep(event: H3Event, db: Db, move: SiteMove): Promise<StepChanges> {
  const siteId = move.movedSiteId
  const { source, target } = sides(event, move)
  const phase = move.phase as MovePhase

  if (phase === 'locking') {
    const waited = Date.now() - Date.parse(move.lockedAt ?? new Date().toISOString())
    if (waited < LOCK_SETTLE_MS) {
      return { changes: {}, waitMs: LOCK_SETTLE_MS - waited, message: 'Waiting for edits to stop everywhere…' }
    }
    return { changes: { phase: 'copying', cursor: { stage: 'users' }, copyStartedAt: new Date().toISOString() }, message: 'Starting to copy.' }
  }

  if (phase === 'copying') return copyStep(event, db, move, source, target)

  if (phase === 'checking') {
    const [mine, theirs] = await Promise.all([source.counts(siteId), target.counts(siteId)])
    const dropped = ((move.counts as { dropped?: Record<string, number> } | null)?.dropped) ?? {}
    const differ = Object.keys(mine).filter(t => (theirs[t] ?? 0) !== mine[t]! - (dropped[t] ?? 0))
    const fileRounds = ((move.counts as { fileRounds?: number } | null)?.fileRounds) ?? 0
    if (!differ.length && move.copyFiles) {
      const [mineFiles, theirFiles] = await Promise.all([source.fileSummary(siteId), target.fileSummary(siteId)])
      if (mineFiles.count !== theirFiles.count || mineFiles.bytes !== theirFiles.bytes) {
        const detail = `${mineFiles.count} files (${mineFiles.bytes} bytes) vs ${theirFiles.count} (${theirFiles.bytes} bytes)`
        if (fileRounds >= MAX_FILE_ROUNDS) {
          return { changes: { phase: 'failed', counts: { source: mine, target: theirs, dropped, files: { source: mineFiles, target: theirFiles } }, error: `The copied files don't match the originals: ${detail}. Cancel the move; the site stays where it is.` }, message: 'The files don\'t match.' }
        }
        // A file that arrived (an email attachment) or failed: go over them again.
        return { changes: { phase: 'copying', cursor: { stage: 'files', files: null, fileIndex: 0, dropped, fileRounds: fileRounds + 1 } }, message: 'Some files differ; going over them again.' }
      }
    }
    if (!differ.length) return { changes: { phase: 'switching', counts: { source: mine, target: theirs, dropped } }, message: 'Every table matches.' }
    // Mail or a log line that arrived since the catch-up: copy it, then count again.
    if (differ.every(t => (CATCH_UP_TABLES as readonly string[]).includes(t))) {
      return { changes: { phase: 'copying', cursor: { stage: 'catchup', table: 0, offset: 0, dropped, fileRounds } }, message: 'A few new messages arrived; copying them.' }
    }
    return {
      changes: { phase: 'failed', counts: { source: mine, target: theirs, dropped }, error: `The copy doesn't match the original in: ${differ.map(t => `${t} (${mine[t]} vs ${theirs[t] ?? 0})`).join(', ')}. Cancel the move; the site stays where it is.` },
      message: 'The copy doesn\'t match.',
    }
  }

  if (phase === 'switching') {
    if (!(await target.setMoveState(siteId, null, 'incoming'))) {
      // Already switched by an earlier attempt that failed afterwards.
      const there = await target.inspect(siteId)
      if (!there.present || there.moveState) throw new Error('The new copy isn\'t ready to be switched on.')
    }
    await source.setMoveState(siteId, 'moved', 'outgoing')
    // The router learns the new address now (pools only; the control plane's own sites aren't listed).
    if (move.fromPool || move.toPool) await syncSiteDirectory(event)
    await logMove(db, move, null, 'switch')
    return { changes: { phase: 'cleaning', switchedAt: new Date().toISOString() }, message: 'The site is live in its new home.' }
  }

  if (phase === 'cleaning') {
    const waited = Date.now() - Date.parse(move.switchedAt ?? new Date().toISOString())
    if (waited < CLEANUP_DELAY_MS) {
      return { changes: {}, waitMs: CLEANUP_DELAY_MS - waited, message: 'Live in its new home. Waiting a minute before removing the old copy…' }
    }
    // Files first: purgeFiles() needs the old copy's row, marked `moved`, to still be there.
    if (move.copyFiles) await source.purgeFiles(siteId)
    await source.purge(siteId)
    return { changes: { phase: 'done' }, message: 'Moved. The old copy has been removed.' }
  }

  return { changes: {}, message: `Nothing to do (${phase}).` }
}

async function copyStep(event: H3Event, db: Db, move: SiteMove, source: MoveStore, target: MoveStore): Promise<StepChanges> {
  const siteId = move.movedSiteId
  const tables = moveTables()
  const cursor = { ...(move.cursor as unknown as CopyCursor) }
  const deadline = Date.now() + STEP_BUDGET_MS

  while (Date.now() < deadline) {
    if (cursor.stage === 'users') {
      // Everyone the site's rows refer to; the control plane holds every account.
      const ids = await source.userIds(siteId)
      const found: { id: string; name: string; email: string; emailVerified: boolean; image: string | null }[] = []
      for (let i = 0; i < ids.length; i += 90) {
        found.push(...await db.select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, image: users.image })
          .from(users).where(inArray(users.id, ids.slice(i, i + 90))))
      }
      await target.ensureUsers(found.map(u => ({ ...u, image: u.image ?? null })))
      Object.assign(cursor, { stage: 'rows', table: 0, offset: 0 })
      continue
    }

    if (cursor.stage === 'rows' || cursor.stage === 'catchup') {
      const list = cursor.stage === 'rows' ? tables.map(t => t.name) : [...CATCH_UP_TABLES]
      const index = cursor.table ?? 0
      if (index >= list.length) {
        if (cursor.stage === 'catchup') return { changes: { phase: 'checking', cursor: null, counts: { dropped: cursor.dropped ?? {}, fileRounds: cursor.fileRounds ?? 0 } }, message: 'Copied. Checking every table…' }
        Object.assign(cursor, { stage: 'kv', kv: null, table: undefined, offset: undefined })
        continue
      }
      const name = list[index]!
      const since = cursor.stage === 'catchup' ? sqlTime(Date.parse(move.copyStartedAt!) - CATCH_UP_SLACK_MS) : undefined
      const page = await source.exportRows(siteId, name, cursor.offset ?? 0, since)
      if (page.rows.length) {
        const { dropped } = await target.importRows(siteId, name, page.rows)
        // Rows of an account deleted meanwhile, left out as its deletion would have; the
        // check allows for them. (Catch-up rows are re-read ones, so they aren't counted.)
        if (dropped && cursor.stage === 'rows') cursor.dropped = { ...cursor.dropped, [name]: (cursor.dropped?.[name] ?? 0) + dropped }
      }
      if (page.next === null) Object.assign(cursor, { table: index + 1, offset: 0 })
      else cursor.offset = page.next
      continue
    }

    if (cursor.stage === 'kv') {
      const page = await source.kvKeys(siteId, cursor.kv ?? null)
      for (let i = 0; i < page.keys.length; i += KV_GET_BATCH) {
        const entries = await source.kvGet(page.keys.slice(i, i + KV_GET_BATCH))
        if (entries.length) await target.kvPut(entries)
      }
      if (page.cursor) cursor.kv = page.cursor
      else if (move.copyFiles) Object.assign(cursor, { stage: 'files', files: null, fileIndex: 0, kv: undefined })
      else Object.assign(cursor, { stage: 'links', link: 0, offset: 0, kv: undefined })
      continue
    }

    if (cursor.stage === 'files') {
      // One listing page at a time, and within it as many files as the step has time for.
      // A file already there at the same size is skipped, so going over them again is cheap.
      const page = await source.fileList(siteId, cursor.files ?? null)
      let i = cursor.fileIndex ?? 0
      for (; i < page.files.length && Date.now() < deadline; i++) {
        const { key, size } = page.files[i]!
        if ((await target.fileSize(key)) === size) continue
        const file = await source.fileGet(key)
        if (file) await target.filePut({ ...file, key })
      }
      if (i < page.files.length) {
        cursor.fileIndex = i
        continue
      }
      if (page.cursor) Object.assign(cursor, { files: page.cursor, fileIndex: 0 })
      else Object.assign(cursor, { stage: 'links', link: 0, offset: 0, files: undefined, fileIndex: undefined })
      continue
    }

    if (cursor.stage === 'links') {
      const links = tables.flatMap(t => t.selfColumns.map(column => ({ table: t.name, column })))
      const index = cursor.link ?? 0
      if (index >= links.length) {
        Object.assign(cursor, { stage: 'catchup', table: 0, offset: 0, link: undefined })
        continue
      }
      const { table, column } = links[index]!
      const page = await source.selfRefs(siteId, table, column, cursor.offset ?? 0)
      if (page.pairs.length) await target.applySelfRefs(siteId, table, column, page.pairs)
      if (page.next === null) Object.assign(cursor, { link: index + 1, offset: 0 })
      else cursor.offset = page.next
      continue
    }
  }

  const label = cursor.stage === 'rows' ? `Copying ${tables[cursor.table ?? 0]?.name ?? ''}…`
    : cursor.stage === 'kv' ? 'Copying plugins and themes…'
      : cursor.stage === 'files' ? 'Copying images and files…'
      : cursor.stage === 'links' ? 'Linking translations…'
        : 'Copying the last few messages…'
  return { changes: { cursor: cursor as unknown as Record<string, unknown> }, message: label }
}

/** Stops a move that hasn't switched yet: the new copy is removed and the site unlocked. */
export async function cancelSiteMove(event: H3Event, id: string, actorUserId: string): Promise<SiteMove> {
  const db = useDb(event)
  const move = await claim(db, id)
  if (!move) throw conflict('A step of this move is running. Try again in a moment.')
  if (!['locking', 'copying', 'checking', 'failed'].includes(move.phase)) {
    await save(db, id, { lockedUntil: null })
    throw conflict(move.phase === 'switching' || move.phase === 'cleaning'
      ? 'The site is already live in its new home, so the move can\'t be cancelled.'
      : 'This move has already finished.')
  }
  const { source, target } = sides(event, move)
  const there = await target.inspect(move.movedSiteId)
  if (there.present) {
    if (move.copyFiles) await target.purgeFiles(move.movedSiteId)
    await target.purge(move.movedSiteId)
  }
  await source.setMoveState(move.movedSiteId, null, 'outgoing')
  const saved = await save(db, id, { phase: 'cancelled', lockedUntil: null })
  await logMove(db, saved, actorUserId, 'cancel')
  return saved
}

async function logMove(db: Db, move: SiteMove, userId: string | null, what: 'start' | 'switch' | 'cancel') {
  const primary = await db.query.sites.findFirst({ where: (s, { eq: e }) => e(s.isPrimary, true), columns: { id: true } })
  if (!primary) return
  await db.insert(auditLogs).values({
    id: ulid(),
    siteId: primary.id,
    userId,
    action: what === 'cancel' ? 'delete' : what === 'start' ? 'create' : 'update',
    resource: 'site_move',
    resourceId: move.movedSiteId,
    after: { what, site: move.siteDomain, from: move.fromPool ?? 'control panel', to: move.toPool ?? 'control panel' },
  })
}
