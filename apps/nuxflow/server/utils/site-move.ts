import type { H3Event } from 'h3'
import { sql, type SQL } from 'drizzle-orm'
import { getTableConfig, SQLiteAsyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '@nuxflow/db/schema'
import { getD1, useDb, type Db } from './db'
import { getCfBindings } from './cf-env'
import { bumpCacheVersionInKv } from './cache-version'
import { isMemberPool } from './control-plane'
import { upsertUserCopy } from './pool-session'
import type { PoolSignInUser } from './pool-sign-in'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { callPool, poolAdminStub } from './pools'
import { clearHostingPlanCache } from './hosting-plans'
import { clearSiteCache } from './site-resolution'
import { httpError } from './response'

/**
 * Moving a site between a hosting platform's control plane and its member pools: the
 * data side. Everything a site owns is copied row for row, keeping every id (the site's
 * own id included), from the database it lives in to another one. The job that drives a
 * move a step at a time is in site-move-job.ts; this file is what each side does when
 * asked, through a MoveStore — the local database, or a pool's over its binding.
 *
 * What a site owns is read from the schema itself, so a table added later moves too:
 * every table with a `site_id` column, plus tables that belong to a site through a parent
 * (`content_revisions` → `content_items`, …), in foreign-key order. Not moved: sign-in
 * state (`site_sessions`, `site_auth_codes` — people sign in again), and data that isn't
 * the site's (accounts live on the control plane; pools keep copies). Media and email
 * files are in the R2 bucket every pool shares, so only their rows move. A site's plugin
 * code and theme CSS live in the Worker's own KV, so those keys are copied too.
 */

/** Tables with a `site_id` that aren't copied. */
const NOT_MOVED = new Set(['site_sessions', 'site_auth_codes'])
/** Tables that background work can still add rows to while a site is locked; copied again just before the switch. */
export const CATCH_UP_TABLES = ['email_messages', 'email_log', 'notifications', 'audit_logs'] as const
/** Per-site KV prefixes (cf-plugin-kv.ts, cf-theme-kv.ts). */
const KV_PREFIXES = (siteId: string) => [`plugin:${siteId}:`, `theme:${siteId}:`]

export type MoveState = 'outgoing' | 'incoming' | 'moved'

export interface MoveTable {
  name: string
  columns: Set<string>
  /** How rows are matched: by `site_id`, or through the parent table that has one. */
  filter: { column: string; parent?: { table: string; column: string } }
  /** Columns referencing users: a row whose user isn't in the target database is dropped (`cascade`) or kept without it (`set null`). */
  userColumns: { column: string; drop: boolean }[]
  /** Columns referencing the same table, written after every row exists. */
  selfColumns: string[]
  hasId: boolean
}

let plan: MoveTable[] | null = null

/** Every table a site owns, parents before children (`sites` first). */
export function moveTables(): MoveTable[] {
  if (plan) return plan
  const configs = (Object.values(schema) as unknown[])
    .filter((v): v is SQLiteTable => v instanceof SQLiteTable)
    .map(t => getTableConfig(t))
  const byName = new Map(configs.map(c => [c.name, c]))
  const hasSiteId = (name: string) => !!byName.get(name)?.columns.some(c => c.name === 'site_id')

  const tables = new Map<string, MoveTable>()
  for (const c of configs) {
    const fks = c.foreignKeys.map((fk) => {
      const ref = fk.reference()
      return { column: ref.columns[0]!.name, table: getTableConfig(ref.foreignTable).name, refColumn: ref.foreignColumns[0]!.name, onDelete: fk.onDelete }
    })
    let filter: MoveTable['filter'] | null = null
    if (c.name === 'sites') filter = { column: 'id' }
    else if (NOT_MOVED.has(c.name)) filter = null
    else if (c.columns.some(col => col.name === 'site_id')) filter = { column: 'site_id' }
    else {
      const parent = fks.find(fk => fk.table !== c.name && hasSiteId(fk.table) && !NOT_MOVED.has(fk.table))
      if (parent) filter = { column: parent.column, parent: { table: parent.table, column: parent.refColumn } }
    }
    if (!filter) continue
    tables.set(c.name, {
      name: c.name,
      columns: new Set(c.columns.map(col => col.name)),
      filter,
      userColumns: fks.filter(fk => fk.table === 'users').map(fk => ({ column: fk.column, drop: fk.onDelete !== 'set null' })),
      selfColumns: fks.filter(fk => fk.table === c.name).map(fk => fk.column),
      hasId: c.columns.some(col => col.name === 'id'),
    })
  }

  // Parents first (Kahn's algorithm, by name within a level so the order is stable).
  const deps = new Map([...tables.keys()].map(name => [name, new Set(
    byName.get(name)!.foreignKeys.map(fk => getTableConfig(fk.reference().foreignTable).name)
      .filter(t => t !== name && tables.has(t)),
  )]))
  const ordered: MoveTable[] = []
  while (deps.size) {
    const ready = [...deps].filter(([, d]) => [...d].every(t => !deps.has(t))).map(([n]) => n).sort()
    if (!ready.length) throw new Error('The schema has a foreign-key cycle between site tables')
    for (const name of ready) {
      ordered.push(tables.get(name)!)
      deps.delete(name)
    }
  }
  plan = ordered
  return plan
}

function tableNamed(name: string): MoveTable | null {
  return moveTables().find(t => t.name === name) ?? null
}

function whereSite(table: MoveTable, siteId: string): SQL {
  const { column, parent } = table.filter
  return parent
    ? sql`${sql.identifier(column)} in (select ${sql.identifier(parent.column)} from ${sql.identifier(parent.table)} where "site_id" = ${siteId})`
    : sql`${sql.identifier(column)} = ${siteId}`
}

// ── What each side does ──────────────────────────────────────────────────────────────

export interface SiteHere {
  present: boolean
  moveState: MoveState | null
  isPrimary: boolean
  domain: string | null
  aliases: string[]
}

export interface ExportedRows {
  rows: Record<string, unknown>[]
  /** Offset to ask for next, or null when the table is done. */
  next: number | null
}

export interface MoveStore {
  inspect(siteId: string): Promise<SiteHere>
  /** Which of these addresses another site here already uses. */
  takenHosts(siteId: string, hosts: string[]): Promise<string[]>
  /** Changes the site's move state, only if it is `expected` now. False otherwise. */
  setMoveState(siteId: string, state: MoveState | null, expected: MoveState | null): Promise<boolean>
  exportRows(siteId: string, table: string, offset: number, since?: string): Promise<ExportedRows>
  /** `dropped`: rows left out because the account they belong to no longer exists. */
  importRows(siteId: string, table: string, rows: Record<string, unknown>[]): Promise<{ inserted: number; dropped: number }>
  selfRefs(siteId: string, table: string, column: string, offset: number): Promise<{ pairs: [string, string][]; next: number | null }>
  applySelfRefs(siteId: string, table: string, column: string, pairs: [string, string][]): Promise<void>
  userIds(siteId: string): Promise<string[]>
  ensureUsers(users: PoolSignInUser[]): Promise<void>
  counts(siteId: string): Promise<Record<string, number>>
  /** Deletes every row of the site — only a copy that is `incoming` or `moved`. */
  purge(siteId: string): Promise<void>
  kvKeys(siteId: string, cursor: KvCursor | null): Promise<{ keys: string[]; cursor: KvCursor | null }>
  kvGet(keys: string[]): Promise<{ key: string; value: string }[]>
  kvPut(entries: { key: string; value: string }[]): Promise<void>
  // Files, only when the two sides keep them in different R2 buckets (a pool with its own,
  // or an EU pool). Which is the case is found out, not configured: one side writes a probe
  // object and the other looks for it — copying a file "between" two names for the same
  // bucket and then deleting the original would lose it.
  /** False when this side has no bucket at all. */
  probeWrite(key: string): Promise<boolean>
  probeSees(key: string): Promise<'yes' | 'no' | 'no-bucket'>
  probeDelete(key: string): Promise<void>
  fileList(siteId: string, cursor: FileCursor | null): Promise<{ files: { key: string; size: number }[]; cursor: FileCursor | null }>
  /** The size of a file here, or null when it isn't. */
  fileSize(key: string): Promise<number | null>
  fileGet(key: string): Promise<MovedFile | null>
  filePut(file: MovedFile & { key: string }): Promise<void>
  fileSummary(siteId: string): Promise<{ count: number; bytes: number }>
  /** Deletes the site's files — only for a copy that is `incoming` or `moved`. */
  purgeFiles(siteId: string): Promise<void>
  /** Media rows whose address points straight at a bucket's public URL, which a copy to another bucket would break. */
  absoluteMediaUrls(siteId: string): Promise<number>
}

export interface KvCursor { prefix: number; cursor?: string }
export interface FileCursor { prefix: number; cursor?: string }
export interface MovedFile {
  body: ReadableStream | ArrayBuffer | Uint8Array
  size: number
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
}

/** Where a site's files are in an R2 bucket: media and theme files, and received mail (inbound-email.ts). */
const FILE_PREFIXES = (siteId: string) => [`${siteId}/`, `_private/${siteId}/`]
const FILE_PAGE = 50
const FILE_PUT_TIMEOUT_MS = 5 * 60_000

const PAGE_ROWS = 200
/** Keeps one page well under the 32 MiB a call between Workers can carry. */
const PAGE_BYTES = 4 * 1024 * 1024
const SELF_REF_PAGE = 500
const INSERT_CHUNK = 50

const dialect = new SQLiteAsyncDialect()

/**
 * Runs writes in batches of INSERT_CHUNK (each batch is one transaction). On D1 they go to
 * the binding directly: Drizzle's D1 batch can't take raw SQL statements (it reads a
 * prepared statement it never made — found running real Workers, not in tests).
 */
async function writeAll(event: H3Event, db: Db, statements: SQL[]): Promise<void> {
  const d1 = getD1(event) as D1Database | null
  for (let i = 0; i < statements.length; i += INSERT_CHUNK) {
    const chunk = statements.slice(i, i + INSERT_CHUNK)
    if (d1) {
      await d1.batch(chunk.map((statement) => {
        const query = dialect.sqlToQuery(statement)
        return d1.prepare(query.sql).bind(...query.params)
      }))
    }
    else {
      const items = chunk.map(statement => db.run(statement))
      await db.batch(items as [typeof items[number], ...typeof items])
    }
  }
}

async function moveStateOf(db: Db, siteId: string): Promise<{ present: boolean; moveState: MoveState | null }> {
  const [row] = await db.all<{ move_state: MoveState | null }>(sql`select move_state from sites where id = ${siteId}`)
  return { present: !!row, moveState: row?.move_state ?? null }
}

/** The site's rows in this Worker's own database (and its KV). */
export function localMoveStore(event: H3Event): MoveStore {
  const db = useDb(event)
  const kv = () => {
    const store = getCfBindings(event).kv
    if (!store) throw new Error('The PLUGIN_KV binding is missing, so plugin code and themes can\'t be moved.')
    return store
  }

  return {
    async inspect(siteId) {
      const [site] = await db.all<{ domain: string; move_state: MoveState | null; is_primary: number }>(sql`select domain, move_state, is_primary from sites where id = ${siteId}`)
      const aliases = site ? await db.all<{ hostname: string }>(sql`select hostname from site_domains where site_id = ${siteId}`) : []
      return {
        present: !!site,
        moveState: site?.move_state ?? null,
        isPrimary: !!site?.is_primary,
        domain: site?.domain ?? null,
        aliases: aliases.map(a => a.hostname),
      }
    },

    async takenHosts(siteId, hosts) {
      if (!hosts.length) return []
      const list = sql.join(hosts.map(h => sql`${h}`), sql`, `)
      const rows = await db.all<{ host: string }>(sql`
        select domain as host from sites where domain in (${list}) and id != ${siteId}
        union select hostname as host from site_domains where hostname in (${list}) and site_id != ${siteId}`)
      return rows.map(r => r.host)
    },

    async setMoveState(siteId, state, expected) {
      const rows = await db.all<{ id: string }>(sql`
        update sites set move_state = ${state}, updated_at = datetime('now')
        where id = ${siteId} and coalesce(move_state, '') = ${expected ?? ''} returning id`)
      clearSiteCache()
      clearHostingPlanCache()
      return rows.length > 0
    },

    async exportRows(siteId, tableName, offset, since) {
      const table = tableNamed(tableName)
      if (!table) return { rows: [], next: null }
      const recent = since && table.columns.has('created_at') ? sql` and created_at >= ${since}` : sql``
      const rows = await db.all<Record<string, unknown>>(sql`
        select * from ${sql.identifier(table.name)} where ${whereSite(table, siteId)}${recent}
        order by rowid limit ${PAGE_ROWS} offset ${offset}`)
      let bytes = 0
      let kept = 0
      for (const row of rows) {
        bytes += JSON.stringify(row).length
        if (kept > 0 && bytes > PAGE_BYTES) break
        kept++
      }
      const page = rows.slice(0, kept)
      return { rows: page, next: kept < rows.length || rows.length === PAGE_ROWS ? offset + kept : null }
    },

    async importRows(siteId, tableName, input) {
      const table = tableNamed(tableName)
      if (!table || !input.length) return { inserted: 0, dropped: 0 }
      const state = await moveStateOf(db, siteId)
      if (table.name === 'sites') {
        if (state.present) throw new Error('This database already has that site.')
      }
      else if (state.moveState !== 'incoming') {
        throw new Error('Rows can only be added to a site that is being moved here.')
      }

      // Users a row refers to must exist here: a member pool keeps copies (ensureUsers
      // runs first); an account deleted meanwhile is treated as the deletion would have.
      const userIds = [...new Set(table.userColumns.flatMap(u => input.map(r => r[u.column]).filter((v): v is string => typeof v === 'string')))]
      const known = new Set<string>()
      for (let i = 0; i < userIds.length; i += 90) {
        const chunk = userIds.slice(i, i + 90)
        const found = await db.all<{ id: string }>(sql`select id from users where id in (${sql.join(chunk.map(id => sql`${id}`), sql`, `)})`)
        for (const f of found) known.add(f.id)
      }

      const statements: SQL[] = []
      let droppedRows = 0
      for (const original of input) {
        const row: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(original)) if (table.columns.has(key)) row[key] = value
        if (table.name === 'sites') {
          row.move_state = 'incoming'
          row.is_primary = 0
        }
        for (const column of table.selfColumns) if (column in row) row[column] = null
        let dropped = false
        for (const { column, drop } of table.userColumns) {
          const value = row[column]
          if (typeof value !== 'string' || known.has(value)) continue
          if (drop) dropped = true
          else row[column] = null
        }
        if (dropped) {
          droppedRows++
          continue
        }
        const columns = Object.keys(row)
        statements.push(sql`insert or ignore into ${sql.identifier(table.name)} (${sql.join(columns.map(c => sql.identifier(c)), sql`, `)}) values (${sql.join(columns.map(c => sql`${row[c] ?? null}`), sql`, `)})`)
      }
      await writeAll(event, db, statements)
      if (table.name === 'sites') clearSiteCache()
      return { inserted: statements.length, dropped: droppedRows }
    },

    async selfRefs(siteId, tableName, column, offset) {
      const table = tableNamed(tableName)
      if (!table?.hasId || !table.selfColumns.includes(column)) return { pairs: [], next: null }
      const rows = await db.all<{ id: string; ref: string }>(sql`
        select id, ${sql.identifier(column)} as ref from ${sql.identifier(table.name)}
        where ${whereSite(table, siteId)} and ${sql.identifier(column)} is not null
        order by rowid limit ${SELF_REF_PAGE} offset ${offset}`)
      return { pairs: rows.map(r => [r.id, r.ref]), next: rows.length === SELF_REF_PAGE ? offset + rows.length : null }
    },

    async applySelfRefs(siteId, tableName, column, pairs) {
      const table = tableNamed(tableName)
      if (!table?.hasId || !table.selfColumns.includes(column) || !pairs.length) return
      if ((await moveStateOf(db, siteId)).moveState !== 'incoming') throw new Error('Rows can only be changed on a site that is being moved here.')
      await writeAll(event, db, pairs.map(([id, ref]) => sql`update ${sql.identifier(table.name)} set ${sql.identifier(column)} = ${ref} where id = ${id} and ${whereSite(table, siteId)}`))
    },

    async userIds(siteId) {
      const ids = new Set<string>()
      for (const table of moveTables()) {
        for (const { column } of table.userColumns) {
          const rows = await db.all<{ id: string }>(sql`select distinct ${sql.identifier(column)} as id from ${sql.identifier(table.name)} where ${whereSite(table, siteId)} and ${sql.identifier(column)} is not null`)
          for (const r of rows) ids.add(r.id)
        }
      }
      return [...ids]
    },

    async ensureUsers(users) {
      // The control plane holds every account; a member pool keeps copies of the ones it needs.
      if (!isMemberPool()) return
      for (const user of users) await upsertUserCopy(db, user)
    },

    async counts(siteId) {
      const out: Record<string, number> = {}
      for (const table of moveTables()) {
        const [row] = await db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table.name)} where ${whereSite(table, siteId)}`)
        out[table.name] = Number(row?.n ?? 0)
      }
      return out
    },

    async purge(siteId) {
      const state = await moveStateOf(db, siteId)
      if (state.present && state.moveState !== 'incoming' && state.moveState !== 'moved') {
        throw new Error('Only a copy left behind by a move can be removed this way.')
      }
      // Children first, so a parent's rows are still there to match them by.
      for (const table of [...moveTables()].reverse()) {
        await db.run(sql`delete from ${sql.identifier(table.name)} where ${whereSite(table, siteId)}`)
      }
      const store = getCfBindings(event).kv
      if (store) {
        for (const prefix of KV_PREFIXES(siteId)) {
          let cursor: string | undefined
          do {
            const page = await store.list({ prefix, cursor })
            for (const key of page.keys) await store.delete(key.name)
            cursor = page.list_complete ? undefined : page.cursor
          } while (cursor)
        }
        // This Worker's cached pages of the site stay in the Cache API until they expire
        // (up to an hour). A fresh cache version means they're never read again, even if
        // the site moves back here within that hour with edits made elsewhere.
        await bumpCacheVersionInKv(store, siteId)
      }
      clearSiteCache()
    },

    async kvKeys(siteId, cursor) {
      const prefixes = KV_PREFIXES(siteId)
      const at = cursor ?? { prefix: 0 }
      if (at.prefix >= prefixes.length) return { keys: [], cursor: null }
      const page = await kv().list({ prefix: prefixes[at.prefix], cursor: at.cursor, limit: 20 })
      const next: KvCursor | null = !page.list_complete
        ? { prefix: at.prefix, cursor: page.cursor }
        : at.prefix + 1 < prefixes.length ? { prefix: at.prefix + 1 } : null
      return { keys: page.keys.map(k => k.name), cursor: next }
    },

    async kvGet(keys) {
      const out: { key: string; value: string }[] = []
      for (const key of keys) {
        const value = await kv().get(key, 'text')
        if (value !== null) out.push({ key, value })
      }
      return out
    },

    async kvPut(entries) {
      for (const { key, value } of entries) await kv().put(key, value)
    },

    async probeWrite(key) {
      const r2 = getCfBindings(event).r2
      if (!r2) return false
      await r2.put(key, 'nuxflow site move probe')
      return true
    },

    async probeSees(key) {
      const r2 = getCfBindings(event).r2
      if (!r2) return 'no-bucket'
      return (await r2.head(key)) ? 'yes' : 'no'
    },

    async probeDelete(key) {
      await getCfBindings(event).r2?.delete(key)
    },

    async fileList(siteId, cursor) {
      const r2 = bucket()
      const prefixes = FILE_PREFIXES(siteId)
      const at = cursor ?? { prefix: 0 }
      if (at.prefix >= prefixes.length) return { files: [], cursor: null }
      const page = await r2.list({ prefix: prefixes[at.prefix], cursor: at.cursor, limit: FILE_PAGE })
      const next: FileCursor | null = page.truncated
        ? { prefix: at.prefix, cursor: page.cursor }
        : at.prefix + 1 < prefixes.length ? { prefix: at.prefix + 1 } : null
      return { files: page.objects.map(o => ({ key: o.key, size: o.size })), cursor: next }
    },

    async fileSize(key) {
      return (await bucket().head(key))?.size ?? null
    },

    async fileGet(key) {
      const object = await bucket().get(key)
      if (!object) return null
      return { body: object.body, size: object.size, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata }
    },

    async filePut({ key, body, size, httpMetadata, customMetadata }) {
      // R2 needs a stream's length up front; one handed over from another Worker doesn't
      // carry it, so it goes through a FixedLengthStream of the size the source reported.
      const Fixed = (globalThis as { FixedLengthStream?: new (length: number) => TransformStream }).FixedLengthStream
      if (Fixed && body instanceof ReadableStream) {
        const { readable, writable } = new Fixed(size)
        await Promise.all([bucket().put(key, readable, { httpMetadata, customMetadata }), body.pipeTo(writable)])
        return
      }
      await bucket().put(key, body, { httpMetadata, customMetadata })
    },

    async fileSummary(siteId) {
      const r2 = bucket()
      let count = 0
      let bytes = 0
      for (const prefix of FILE_PREFIXES(siteId)) {
        let cursor: string | undefined
        do {
          const page = await r2.list({ prefix, cursor })
          for (const o of page.objects) {
            count++
            bytes += o.size
          }
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor)
      }
      return { count, bytes }
    },

    async purgeFiles(siteId) {
      // Stricter than purge(): the copy must still be here and marked, never "no such site",
      // because a site absent from this database may well have its files in this bucket.
      const state = await moveStateOf(db, siteId)
      if (!state.present || (state.moveState !== 'incoming' && state.moveState !== 'moved')) {
        throw new Error('Only the files of a copy left behind by a move can be removed this way.')
      }
      const r2 = bucket()
      for (const prefix of FILE_PREFIXES(siteId)) {
        let cursor: string | undefined
        do {
          const page = await r2.list({ prefix, cursor })
          const keys = page.objects.map(o => o.key)
          if (keys.length) await r2.delete(keys)
          cursor = page.truncated ? page.cursor : undefined
        } while (cursor)
      }
    },

    async absoluteMediaUrls(siteId) {
      const [row] = await db.all<{ n: number }>(sql`select count(*) as n from media where site_id = ${siteId} and storage_provider = 'r2' and url not like '/%'`)
      return Number(row?.n ?? 0)
    },
  }

  function bucket(): R2Bucket {
    const r2 = getCfBindings(event).r2
    if (!r2) throw new Error('The MEDIA_BUCKET binding is missing, so files can\'t be moved.')
    return r2
  }
}

// ── Across the pool binding ──────────────────────────────────────────────────────────

export type MoveOp =
  | { op: 'inspect' }
  | { op: 'takenHosts'; hosts: string[] }
  | { op: 'setMoveState'; state: MoveState | null; expected: MoveState | null }
  | { op: 'exportRows'; table: string; offset: number; since?: string }
  | { op: 'importRows'; table: string; rows: Record<string, unknown>[] }
  | { op: 'selfRefs'; table: string; column: string; offset: number }
  | { op: 'applySelfRefs'; table: string; column: string; pairs: [string, string][] }
  | { op: 'userIds' }
  | { op: 'ensureUsers'; users: PoolSignInUser[] }
  | { op: 'counts' }
  | { op: 'purge' }
  | { op: 'kvKeys'; cursor: KvCursor | null }
  | { op: 'kvGet'; keys: string[] }
  | { op: 'kvPut'; entries: { key: string; value: string }[] }
  | { op: 'probeWrite'; key: string }
  | { op: 'probeSees'; key: string }
  | { op: 'probeDelete'; key: string }
  | { op: 'fileList'; cursor: FileCursor | null }
  | { op: 'fileSize'; key: string }
  | { op: 'fileGet'; key: string }
  | { op: 'filePut'; file: MovedFile & { key: string } }
  | { op: 'fileSummary' }
  | { op: 'purgeFiles' }
  | { op: 'absoluteMediaUrls' }

/** A member pool doing its part of a move, as its control plane asks. */
export async function poolSiteMove(event: H3Event, input: { protocol: number; siteId: string; op: MoveOp }): Promise<unknown> {
  assertCompatibleProtocol(input.protocol)
  const store = localMoveStore(event)
  const { op, siteId } = input
  switch (op.op) {
    case 'inspect': return store.inspect(siteId)
    case 'takenHosts': return store.takenHosts(siteId, op.hosts)
    case 'setMoveState': return store.setMoveState(siteId, op.state, op.expected)
    case 'exportRows': return store.exportRows(siteId, op.table, op.offset, op.since)
    case 'importRows': return store.importRows(siteId, op.table, op.rows)
    case 'selfRefs': return store.selfRefs(siteId, op.table, op.column, op.offset)
    case 'applySelfRefs': return store.applySelfRefs(siteId, op.table, op.column, op.pairs)
    case 'userIds': return store.userIds(siteId)
    case 'ensureUsers': return store.ensureUsers(op.users)
    case 'counts': return store.counts(siteId)
    case 'purge': return store.purge(siteId)
    case 'kvKeys': return store.kvKeys(siteId, op.cursor)
    case 'kvGet': return store.kvGet(op.keys)
    case 'kvPut': return store.kvPut(op.entries)
    case 'probeWrite': return store.probeWrite(op.key)
    case 'probeSees': return store.probeSees(op.key)
    case 'probeDelete': return store.probeDelete(op.key)
    case 'fileList': return store.fileList(siteId, op.cursor)
    case 'fileSize': return store.fileSize(op.key)
    case 'fileGet': return store.fileGet(op.key)
    case 'filePut': return store.filePut(op.file)
    case 'fileSummary': return store.fileSummary(siteId)
    case 'purgeFiles': return store.purgeFiles(siteId)
    case 'absoluteMediaUrls': return store.absoluteMediaUrls(siteId)
    default: throw new Error(`Unknown move operation: ${(op as { op: string }).op}`)
  }
}

function poolMoveStore(event: H3Event, poolId: string): MoveStore {
  const stub = poolAdminStub(event, poolId)
  if (!stub) throw httpError({ status: 503, message: `Pool "${poolId}" isn't connected to this control panel.` })
  // Copying one large file can take minutes; everything else answers in moments.
  const call = <T>(siteId: string, op: MoveOp) => callPool(stub.siteMove({ protocol: POOL_PROTOCOL, siteId, op }), `pool ${poolId}`, op.op === 'filePut' ? FILE_PUT_TIMEOUT_MS : undefined) as Promise<T>
  return {
    inspect: siteId => call(siteId, { op: 'inspect' }),
    takenHosts: (siteId, hosts) => call(siteId, { op: 'takenHosts', hosts }),
    setMoveState: (siteId, state, expected) => call(siteId, { op: 'setMoveState', state, expected }),
    exportRows: (siteId, table, offset, since) => call(siteId, { op: 'exportRows', table, offset, since }),
    importRows: (siteId, table, rows) => call(siteId, { op: 'importRows', table, rows }),
    selfRefs: (siteId, table, column, offset) => call(siteId, { op: 'selfRefs', table, column, offset }),
    applySelfRefs: (siteId, table, column, pairs) => call(siteId, { op: 'applySelfRefs', table, column, pairs }),
    userIds: siteId => call(siteId, { op: 'userIds' }),
    ensureUsers: users => call('', { op: 'ensureUsers', users }),
    counts: siteId => call(siteId, { op: 'counts' }),
    purge: siteId => call(siteId, { op: 'purge' }),
    kvKeys: (siteId, cursor) => call(siteId, { op: 'kvKeys', cursor }),
    kvGet: keys => call('', { op: 'kvGet', keys }),
    kvPut: entries => call('', { op: 'kvPut', entries }),
    probeWrite: key => call('', { op: 'probeWrite', key }),
    probeSees: key => call('', { op: 'probeSees', key }),
    probeDelete: key => call('', { op: 'probeDelete', key }),
    fileList: (siteId, cursor) => call(siteId, { op: 'fileList', cursor }),
    fileSize: key => call('', { op: 'fileSize', key }),
    // A file's body crosses the binding as a stream, so large files never sit in memory.
    fileGet: key => call('', { op: 'fileGet', key }),
    filePut: file => call('', { op: 'filePut', file }),
    fileSummary: siteId => call(siteId, { op: 'fileSummary' }),
    purgeFiles: siteId => call(siteId, { op: 'purgeFiles' }),
    absoluteMediaUrls: siteId => call(siteId, { op: 'absoluteMediaUrls' }),
  }
}

/** Where a site's data is (null = this Worker). */
export function moveStore(event: H3Event, poolId: string | null): MoveStore {
  return poolId ? poolMoveStore(event, poolId) : localMoveStore(event)
}
