import type { H3Event } from 'h3'
import { getD1 } from './db'

// Whole-D1-instance SQL dump — not the per-site JSON backup in backup.ts. `wrangler d1
// export` is a CLI-only tool (it shells out to Cloudflare's API from the developer's
// machine, not something a live Worker can invoke), so this reimplements the same idea
// from inside a request: introspect the database's actual schema via sqlite_master and
// emit a portable, restorable .sql file. Every site's data comes back in one file — this
// is a database-level backup, not a site-level one — which is why the only caller
// (server/api/v1/admin/db-export.get.ts) gates it behind requireSuperAdmin, not the
// site-scoped requireRole() the per-site backup route uses.
//
// Deliberately avoids PRAGMA entirely, even the subset Cloudflare's own docs list as
// supported (table_info, foreign_key_list — https://developers.cloudflare.com/d1/sql-api/sql-statements/).
// Both were tried here first and both 500'd against a real deployment with
// `D1_ERROR: not authorized: SQLITE_AUTH` when run inside a `d1.batch()` call — D1's
// authorizer rejects them in that context even though the docs list them as supported
// standalone, and this only surfaced against real D1 (wrangler dev's local D1 emulation
// accepted them fine). Rather than keep the file's two other genuinely necessary pieces
// of PRAGMA-derived data (table dependency order, column names) tied to a call D1
// silently rejects under batching, both are now derived without PRAGMA at all: dependency
// order falls back to whatever order sqlite_master already returns tables in (correctness
// never depended on real ordering here anyway — see the transaction-wrapping comment
// below), and column names come from the keys of each table's own first returned row.
//
// Also deliberately avoids d1.batch() for row data, for the same "found out against a
// real deployment" reason: batching every table's full SELECT together made D1 hold
// every table's complete result set in its own isolate's memory at once, which 500'd with
// "D1 DB's isolate exceeded its memory limit and was reset" against real production data
// (never reproduced locally — a fresh/empty local dev database has nothing to reproduce it
// with). Fetched one table at a time instead, paginated (LIMIT/OFFSET).
//
// Page size is *adaptive*, not fixed: a first attempt at 1000 rows/page still hit the same
// isolate-memory error on `content_items` alone (offset 0 — i.e. this schema has at least
// one table whose rows are large enough that even one page of 1000 overflows D1's 128 MB
// per-isolate ceiling for materializing a query result — Cloudflare doesn't document an
// explicit row-count-per-query limit, only a 2 MB max row size and that 128 MB isolate
// cap). Rather than guess a fixed number small enough for every possible deployment (and
// risk being needlessly slow for one with small rows, or still wrong for one with larger
// ones), the per-table fetch loop below halves the page size and retries the same offset
// whenever D1 reports an isolate-memory rejection specifically, down to a floor of 10
// rows. D1 also caps a paid plan at 1,000 queries per Worker invocation total (not per
// table) — tracked here via a shared budget across every table, so a very large database
// fails with a clear message pointing at the CLI tool instead of silently running out
// mid-export.
//
// **Streaming, not buffering.** Fixing the isolate-memory error above (D1's own per-query
// ceiling) surfaced a *different* one on the next real deploy: "Worker exceeded memory
// limit" — this Worker's own isolate memory cap, completely separate from D1's. The
// earlier version fetched pages correctly but still pushed every generated INSERT
// statement into one `parts: string[]` for the *entire database* and returned it all as
// one string once every table was done — so a real deployment's total dump size (easily
// hundreds of MB of SQL text once escaped/hex-encoded) blew this Worker's own memory
// ceiling regardless of how carefully the D1 side was paginated. `streamD1TableData()`
// below fixes this by writing each generated chunk out via a caller-supplied `write()`
// callback immediately, never holding more than one page's worth of rows/SQL text at a
// time — `server/api/v1/admin/db-export.get.ts` wires that callback straight to the HTTP
// response body (the same TransformStream + sendStream() pattern already used by
// wordpress.post.ts's import progress stream) so bytes reach the client as they're
// produced instead of accumulating here. `generateD1SqlDump()` further below is a
// buffering convenience wrapper around the same two functions, kept for tests and any
// caller that actually wants the whole dump as one string — it reintroduces the exact
// memory-accumulation problem described above, so it must never be used by the live HTTP
// export route.

interface SqliteMasterRow {
  type: string
  name: string
  sql: string | null
}

const IDENTIFIER_PATTERN = /^[a-z_]\w*$/i

// Table/column names here always come from sqlite_master or an actual returned row's own
// keys — trusted system catalogs and real data, not user input — but they still get
// interpolated directly into SQL (identifiers can't be bound as query parameters), so
// this is defense in depth against ever silently exporting something unexpected rather
// than a real injection vector.
function assertSafeIdentifier(name: string): void {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw createError({ statusCode: 500, message: `D1 export: unexpected identifier "${name}" in database schema` })
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof ArrayBuffer) return `X'${Buffer.from(value).toString('hex')}'`
  if (ArrayBuffer.isView(value)) {
    const view = value as Uint8Array
    return `X'${Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex')}'`
  }
  return `'${String(value).replace(/'/g, '\'\'')}'`
}

function asStatement(sql: string): string {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

const ROWS_PER_INSERT = 200
// Starting page size for SELECT ... LIMIT/OFFSET — backs off adaptively on an isolate-
// memory rejection (see the module doc), so this is a reasonable initial guess, not a
// hard bound. MIN_ROWS_PER_PAGE is the floor: below this, a rejection means a single row
// (or a small handful) is itself too large to fetch this way, not a page-size problem.
const INITIAL_ROWS_PER_PAGE = 1000
const MIN_ROWS_PER_PAGE = 10
// Tables that routinely hold large JSON blobs (a full TipTap/canvas document per row,
// a point-in-time revision snapshot, or base64-encoded media data) start pagination at
// this much smaller page size instead of INITIAL_ROWS_PER_PAGE. Found the hard way: a
// table with real WordPress-imported content has rows up to ~2 MB (Cloudflare's own
// documented max row size) — a first LIMIT 1000 page on a table with only a few dozen
// such rows still fetches the *entire* table in one D1 call (LIMIT can't return more
// rows than exist, so a small table is never actually "paginated" at the default size),
// which is enough to overflow this Worker's own isolate memory under `wrangler dev`
// (D1 runs embedded in the same isolate locally, unlike production's separate D1
// service) *before* the adaptive backoff below ever gets a chance to run — the isolate
// is killed outright, not a catchable JS exception, so the export silently truncates
// with no EXPORT FAILED marker. Starting these tables small avoids that first-attempt
// overflow instead of relying on a retry that may never fire.
const LARGE_ROW_TABLES = new Set(['content_items', 'content_revisions', 'media'])
const INITIAL_ROWS_PER_PAGE_LARGE = 20
// Paid-plan ceiling on D1 queries per Worker invocation — not per table, the whole
// export shares this budget. Left with headroom under Cloudflare's documented 1,000
// (https://developers.cloudflare.com/d1/platform/limits/) for the sqlite_master query
// and any retries backing off already counted against it.
const MAX_D1_QUERIES = 900
// Safety ceiling on total output size. No longer a Worker-memory protection now that the
// live HTTP route streams (see the module doc) — each chunk is written and discarded, not
// accumulated — but still a sane stopping point: a dump this large is impractical to hand
// back through a browser download regardless, and a deployment past this size should use
// `wrangler d1 export` from the CLI instead (no size/duration limit there). Still fully
// protective for generateD1SqlDump()'s buffering wrapper below, which does hold the whole
// dump in memory.
const MAX_DUMP_BYTES = 200 * 1024 * 1024

function isIsolateMemoryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /exceeded its memory limit/i.test(message)
}

export interface D1DumpResult {
  sql: string
  tableCount: number
  rowCount: number
}

export interface D1DumpPreparation {
  /** Real, non-shadow tables to fetch row data for, in the order their INSERTs should run. */
  dataTables: SqliteMasterRow[]
  /** Leading comments, PRAGMA/BEGIN TRANSACTION, and every schema DDL statement — safe to
   *  write to the client immediately since it's small and bounded regardless of database
   *  size (unlike row data, which is not). */
  headerText: string
}

// Re-throws with the failing step named, so a D1-level rejection (SQLITE_AUTH, isolate
// memory limits, and whatever else D1 restricts beyond what's documented — discovered
// the hard way, more than once, building this feature) is diagnosable from the response
// alone instead of needing a wrangler tail session to find out which query failed.
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`[${label}] ${message}`, { cause: err })
  }
}

// Schema introspection only — no row data. Kept separate from streamD1TableData() so
// db-export.get.ts can await this *before* it commits to a 200 response and starts
// streaming: a failure here (bad identifier, D1 rejecting the sqlite_master query itself)
// can still become a clean, labeled HTTP error response the normal way, since nothing has
// reached the client yet. Once streaming starts, that's no longer possible — see
// streamD1TableData()'s own doc.
export async function prepareD1Dump(event: H3Event): Promise<D1DumpPreparation> {
  const d1 = getD1(event)

  // `_cf_%` excludes D1's own internal bookkeeping tables (found the hard way: `_cf_KV`,
  // backing D1's KV-compatible API surface, shows up in sqlite_master like any real
  // table, but D1's authorizer hard-blocks any query against it — "access to _cf_KV.key
  // is prohibited: SQLITE_AUTH" — even a plain SELECT, let alone one this function would
  // never want to dump in the first place). `sqlite_%` excludes SQLite's own internal
  // tables (autoindexes, sqlite_sequence for AUTOINCREMENT columns, if any existed).
  const master = await step('sqlite_master query', () => d1.prepare(
    `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name`,
  ).all<SqliteMasterRow>())
  const entries = master.results
  for (const e of entries) assertSafeIdentifier(e.name)

  // FTS5 virtual tables (e.g. search_index, see migrations/0002_search_index.sql) own a
  // set of auto-created shadow tables (name_data/_idx/_docsize/_content/_config). Those
  // shadow tables aren't ordinary rows — they're fts5's internal storage, recreated
  // automatically by the virtual table's own CREATE statement and not meaningfully
  // hand-populated via plain INSERT — so both they and the virtual table itself are
  // excluded from the data dump. The virtual table's logical rows come back for free
  // once its own AFTER INSERT/UPDATE/DELETE triggers fire again as their source table's
  // data is restored (that's the same mechanism that keeps it in sync live, per
  // CLAUDE.md's Search section), so dumping its rows directly would just risk duplicates.
  const virtualTableNames = new Set(
    entries.filter(e => e.type === 'table' && /^CREATE VIRTUAL TABLE/i.test(e.sql ?? '')).map(e => e.name),
  )
  const shadowSuffixes = ['_data', '_idx', '_docsize', '_content', '_config']
  const shadowTableNames = new Set<string>()
  for (const vt of virtualTableNames) {
    for (const suffix of shadowSuffixes) shadowTableNames.add(`${vt}${suffix}`)
  }

  const realTables = entries.filter(e => e.type === 'table' && !shadowTableNames.has(e.name))
  // sqlite_master's own alphabetical order (from the ORDER BY above) is all the ordering
  // this needs — correctness doesn't depend on parent-before-child insert order: the
  // whole dump runs inside `wrangler d1 execute`'s own implicit per-file transaction, and
  // PRAGMA defer_foreign_keys=TRUE (written into the output file — a restore tool executes
  // it, this Worker never does) defers every FK check, including self-references within
  // the same table (e.g. taxonomy_terms.parent_id), to the end of that transaction. A real
  // dependency sort was tried here and
  // required PRAGMA foreign_key_list, which D1 rejects inside a batch (see the module
  // doc) — not worth reintroducing for what was already just a readability nicety.
  const dataTables = realTables.filter(e => !virtualTableNames.has(e.name))

  const parts: string[] = []
  parts.push('-- NuxFlow D1 export — every site in this database instance')
  parts.push(`-- Generated ${new Date().toISOString()}`)
  parts.push('-- Restore: wrangler d1 execute <database-name> --remote --file=<this file>')
  // No explicit BEGIN TRANSACTION here (this file used to emit one, paired with a COMMIT
  // at the end) — `wrangler d1 execute --file` already wraps the whole file in its own
  // implicit transaction, and starting a second one inside that throws
  // "cannot start a transaction within a transaction" on the very first statement,
  // before a single CREATE TABLE runs. PRAGMA defer_foreign_keys=TRUE still defers FK
  // checks to the end of *that* implicit transaction, so out-of-order inserts (see the
  // comment on `dataTables` below) remain safe without this file managing the
  // transaction itself. https://developers.cloudflare.com/d1/best-practices/import-export-data/
  parts.push('PRAGMA defer_foreign_keys=TRUE;')

  // Schema: real tables (including virtual tables, excluding their shadow tables) first,
  // then indexes/triggers/views — DDL that references a table needs it to exist first.
  for (const e of realTables) parts.push(asStatement(e.sql!))
  for (const e of entries) {
    if (e.type === 'table') continue
    parts.push(asStatement(e.sql!))
  }

  return { dataTables, headerText: parts.join('\n\n') }
}

// Fetches and writes every data table's rows, one table and one page at a time, via the
// caller-supplied `write()` callback — never accumulates more than one page's worth of
// generated SQL text at once. This is what makes the live HTTP export route safe against
// this Worker's own memory limit for a real, large database (see the module doc); a
// caller that buffers everything `write()` produces (generateD1SqlDump() below) reverts
// to holding the full dump in memory and must not be used by that route.
export async function streamD1TableData(
  event: H3Event,
  dataTables: SqliteMasterRow[],
  write: (chunk: string) => void | Promise<void>,
): Promise<{ tableCount: number; rowCount: number }> {
  const d1 = getD1(event)

  let queryCount = 0
  function checkQueryBudget(): void {
    if (queryCount >= MAX_D1_QUERIES) {
      throw createError({
        statusCode: 413,
        message: `D1 export exceeds the ${MAX_D1_QUERIES}-query budget for one Worker invocation (Cloudflare caps a paid plan at 1,000 D1 queries per invocation) — this database has too much data to export from the admin UI. Use \`wrangler d1 export\` from the CLI instead (no such limit there).`,
      })
    }
    queryCount++
  }

  let totalRows = 0
  let tablesWithData = 0
  let bytesWritten = 0

  // One table at a time, one page at a time — see the module doc for why (a single
  // d1.batch() across every table's full data used to OOM D1's own isolate, and even
  // one buffered giant string used to OOM this Worker's own isolate). Page size resets to
  // INITIAL_ROWS_PER_PAGE for every table and adapts independently — different tables
  // have very different row-size profiles (a `sites` row is tiny; a `content_items` row
  // holding a full TipTap document might not be), so a size that had to back off for one
  // shouldn't needlessly slow down every table after it.
  for (const table of dataTables) {
    checkQueryBudget()
    const countRow = await step(`count ${table.name}`, () =>
      d1.prepare(`SELECT COUNT(*) as c FROM "${table.name}"`).all<{ c: number }>())
    const expectedTotal = Number(countRow.results[0]?.c ?? 0)
    if (expectedTotal === 0) continue // nothing to insert

    await write(`\n\n-- Table: ${table.name} (${expectedTotal} row${expectedTotal === 1 ? '' : 's'})\n`)
    tablesWithData++

    let offset = 0
    let pageSize = LARGE_ROW_TABLES.has(table.name) ? INITIAL_ROWS_PER_PAGE_LARGE : INITIAL_ROWS_PER_PAGE
    let columnNames: string[] | null = null

    for (;;) {
      checkQueryBudget()
      let rows: Record<string, unknown>[]
      try {
        const page = await step(`select ${table.name} (offset ${offset}, page ${pageSize})`, () =>
          d1.prepare(`SELECT * FROM "${table.name}" LIMIT ? OFFSET ?`).bind(pageSize, offset).all<Record<string, unknown>>())
        rows = page.results
      } catch (err) {
        if (isIsolateMemoryError(err) && pageSize > MIN_ROWS_PER_PAGE) {
          // D1's per-query memory ceiling isn't documented as a row count (Cloudflare
          // publishes a 2 MB max row size and a 128 MB per-isolate limit, not a rows/query
          // figure), so there's no fixed page size that's provably safe for every
          // deployment — back off and retry the same offset instead of guessing one.
          pageSize = Math.max(MIN_ROWS_PER_PAGE, Math.floor(pageSize / 4))
          continue
        }
        if (isIsolateMemoryError(err)) {
          // Already at the floor and still rejected — a single row (or a small handful)
          // in this table is itself too large to fetch this way, not a page-size problem.
          throw createError({
            statusCode: 413,
            message: `D1 export: table "${table.name}" still exceeds D1's isolate memory limit even at ${MIN_ROWS_PER_PAGE} rows/page (around offset ${offset}) — at least one row there is too large to export from the admin UI. Use \`wrangler d1 export\` from the CLI instead.`,
          })
        }
        throw err
      }
      if (rows.length === 0) break

      if (columnNames === null) {
        // Column names come from the first row's own keys, in the order D1 returned
        // them (matches the table's schema-defined column order — the same thing
        // PRAGMA table_info would have given, without needing that PRAGMA call at all).
        columnNames = Object.keys(rows[0]!)
        for (const c of columnNames) assertSafeIdentifier(c)
      }
      const cols = columnNames
      const columnList = cols.map(c => `"${c}"`).join(',')

      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        const chunk = rows.slice(i, i + ROWS_PER_INSERT)
        const valuesList = chunk.map(row => `(${cols.map(c => sqlLiteral(row[c])).join(',')})`).join(',\n')
        const line = `INSERT INTO "${table.name}" (${columnList}) VALUES\n${valuesList};\n`
        bytesWritten += line.length
        if (bytesWritten > MAX_DUMP_BYTES) {
          throw createError({
            statusCode: 413,
            message: `D1 export exceeds the ${MAX_DUMP_BYTES / (1024 * 1024)} MB safety limit for an in-Worker export — this database is too large to export from the admin UI. Use \`wrangler d1 export\` from the CLI instead (no request size/duration limit there).`,
          })
        }
        await write(line)
      }
      totalRows += rows.length
      offset += rows.length

      if (rows.length < pageSize) break // last page
    }
  }

  return { tableCount: tablesWithData, rowCount: totalRows }
}

// Buffering convenience wrapper around prepareD1Dump()/streamD1TableData() — returns the
// whole dump as one string. Used by tests and any non-HTTP caller that genuinely wants
// the full text in memory. MUST NOT be used by the live HTTP export route
// (server/api/v1/admin/db-export.get.ts calls the two lower-level functions directly
// instead) — buffering here reintroduces the exact "Worker exceeded memory limit" failure
// the streaming split was built to fix, for any database large enough to matter.
export async function generateD1SqlDump(event: H3Event): Promise<D1DumpResult> {
  const prep = await prepareD1Dump(event)
  const parts: string[] = [prep.headerText]
  const { tableCount, rowCount } = await streamD1TableData(event, prep.dataTables, (chunk) => {
    parts.push(chunk)
  })
  parts.push(`\n\n-- Exported ${tableCount} table${tableCount === 1 ? '' : 's'}, ${rowCount} row${rowCount === 1 ? '' : 's'}`)
  return { sql: parts.join(''), tableCount, rowCount }
}
