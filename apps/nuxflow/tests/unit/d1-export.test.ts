import { describe, it, expect, vi } from 'vitest'
import type { H3Event } from 'h3'

// Mock h3's createError global — this runs outside Nuxt/h3 context in a unit test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).createError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).createError = (err: { statusCode: number; message: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = new Error(err.message) as any
    error.statusCode = err.statusCode
    return error
  }
}

interface FakeTable {
  schema: string
  rows: Record<string, unknown>[]
}

// A minimal stand-in for the real D1Database binding — just enough of
// prepare(sql).bind(...).all() to answer the three query shapes generateD1SqlDump()
// issues (sqlite_master, per-table SELECT COUNT(*), paginated SELECT * ... LIMIT ?
// OFFSET ?). No PRAGMA and no d1.batch() here at all — see the module doc in
// d1-export.ts for why (both were tried and both failed against real D1 in ways that
// never reproduced locally: PRAGMA table_info/foreign_key_list rejected with
// SQLITE_AUTH when batched, and batching every table's full SELECT together OOM'd D1's
// own isolate).
function makeFakeD1(tables: Record<string, FakeTable>) {
  return {
    prepare(sql: string) {
      const stmt = {
        sql,
        params: [] as unknown[],
        bind(...params: unknown[]) {
          stmt.params = params
          return stmt
        },
        async all() {
          if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) {
            return {
              results: Object.entries(tables).map(([name, t]) => ({ type: 'table', name, sql: t.schema })),
              success: true,
              meta: {},
            }
          }
          const count = sql.match(/SELECT COUNT\(\*\) as c FROM "(.+)"/)
          if (count) {
            return { results: [{ c: tables[count[1]!]?.rows.length ?? 0 }], success: true, meta: {} }
          }
          const select = sql.match(/SELECT \* FROM "(.+)" LIMIT \? OFFSET \?/)
          if (select) {
            const [limit, offset] = stmt.params as [number, number]
            const allRows = tables[select[1]!]?.rows ?? []
            return { results: allRows.slice(offset, offset + limit), success: true, meta: {} }
          }
          throw new Error(`Unexpected SQL against fake D1: ${sql}`)
        },
      }
      return stmt
    },
  }
}

function mkEvent() {
  return {} as unknown as H3Event
}

describe('generateD1SqlDump()', () => {
  it('emits schema and correctly-escaped INSERT statements for an ordinary table', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        sites: {
          schema: 'CREATE TABLE "sites" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "domain" TEXT)',
          rows: [
            { id: 'site-1', name: "O'Brien's Blog", domain: 'example.com' },
            { id: 'site-2', name: null, domain: 'test.localhost' },
          ],
        },
      }),
    }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    const { sql, tableCount, rowCount } = await generateD1SqlDump(mkEvent())

    expect(tableCount).toBe(1)
    expect(rowCount).toBe(2)
    expect(sql).toContain('CREATE TABLE "sites"')
    expect(sql).toContain('PRAGMA defer_foreign_keys=TRUE;')
    // No explicit BEGIN TRANSACTION/COMMIT — `wrangler d1 execute --file` already wraps
    // the whole file in its own implicit transaction, and an explicit one nested inside
    // it throws "cannot start a transaction within a transaction" before the first
    // statement runs. See the comment in d1-export.ts for the full explanation.
    expect(sql).not.toContain('BEGIN TRANSACTION')
    expect(sql).not.toContain('COMMIT;')
    expect(sql).toMatch(/-- Exported \d+ tables?, \d+ rows?/)
    // Single quotes in string values are doubled, not left unescaped
    expect(sql).toContain("'O''Brien''s Blog'")
    // NULL columns come through as the literal NULL, not the string "null"
    expect(sql).toMatch(/\('site-2',NULL,'test\.localhost'\)/)
  })

  it('paginates via LIMIT/OFFSET across multiple pages and stops once a short page confirms the end', async () => {
    // ROWS_PER_PAGE is 1000 (module-internal) — a table with exactly that many rows on
    // its first page looks like there could be more, so a second (short) page is needed
    // to confirm the end; a table with fewer rows than one page needs only a single call
    // (covered implicitly by every other test here, which use small fixtures).
    vi.resetModules()
    const pageOffsetsSeen: number[] = []
    const d1 = {
      prepare(sql: string) {
        const stmt = {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) { stmt.params = params; return stmt },
          async all() {
            if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) {
              return {
                results: [{ type: 'table', name: 'paged', sql: 'CREATE TABLE "paged" ("id" TEXT)' }],
                success: true,
                meta: {},
              }
            }
            if (sql.startsWith('SELECT COUNT(*)')) {
              return { results: [{ c: 1001 }], success: true, meta: {} }
            }
            const [limit, offset] = stmt.params as [number, number]
            pageOffsetsSeen.push(offset)
            if (offset === 0) {
              return { results: Array.from({ length: limit }, (_, i) => ({ id: `row-${i}` })), success: true, meta: {} }
            }
            return { results: [{ id: 'last-row' }], success: true, meta: {} } // short page — confirms the end
          },
        }
        return stmt
      },
    }
    vi.doMock('../../server/utils/db', () => ({ getD1: () => d1 }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    const { rowCount } = await generateD1SqlDump(mkEvent())
    expect(rowCount).toBe(1001) // 1000-row first page + 1-row second page
    expect(pageOffsetsSeen).toEqual([0, 1000]) // exactly two round trips, second one offset by the first page's size
  })

  it('excludes FTS5 shadow tables and the virtual table itself from the data dump, but keeps their schema', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        search_index: {
          schema: "CREATE VIRTUAL TABLE search_index USING fts5(content_item_id UNINDEXED, title, body)",
          rows: [{ content_item_id: 'c1', title: 'Hello', body: 'World' }],
        },
        search_index_data: {
          schema: 'CREATE TABLE \'search_index_data\'(id INTEGER PRIMARY KEY, block BLOB)',
          rows: [{ id: 1, block: 'binary-ish' }],
        },
        search_index_config: {
          schema: 'CREATE TABLE \'search_index_config\'(k PRIMARY KEY, v) WITHOUT ROWID',
          rows: [{ k: 'version', v: 4 }],
        },
      }),
    }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    const { sql, tableCount, rowCount } = await generateD1SqlDump(mkEvent())

    // Schema for the virtual table itself is kept (needed so its triggers/shadow
    // tables exist before any source-table data is restored)...
    expect(sql).toContain('CREATE VIRTUAL TABLE search_index USING fts5')
    // ...but none of it, nor its shadow tables, gets a data dump: the virtual table's
    // shadow tables are fts5-internal storage recreated by that CREATE statement, and
    // the virtual table's own logical rows come back via the triggers on their real
    // source table instead (see the comment in d1-export.ts).
    expect(sql).not.toContain('INSERT INTO "search_index"')
    expect(sql).not.toContain('INSERT INTO "search_index_data"')
    expect(sql).not.toContain('INSERT INTO "search_index_config"')
    expect(tableCount).toBe(0)
    expect(rowCount).toBe(0)
  })

  it('sends a sqlite_master query that excludes D1-internal _cf_% tables (e.g. _cf_KV)', async () => {
    // D1's own _cf_KV table (backing its KV-compatible API) shows up in sqlite_master
    // like any real table, but D1's authorizer hard-blocks any query against it —
    // "access to _cf_KV.key is prohibited: SQLITE_AUTH" — found only against a real
    // deployment, since a fake/local sqlite_master never has it to begin with. A fake D1
    // can't evaluate the WHERE clause itself (that's D1's job, not this code's), so the
    // regression this actually guards against is the exclusion disappearing from the
    // query text — capture what was sent and assert on that directly.
    vi.resetModules()
    let sqliteMasterQuery = ''
    const d1 = {
      prepare(sql: string) {
        if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) sqliteMasterQuery = sql
        const stmt = {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) { stmt.params = params; return stmt },
          async all() {
            if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) {
              return { results: [], success: true, meta: {} }
            }
            throw new Error(`Unexpected SQL against fake D1: ${sql}`)
          },
        }
        return stmt
      },
    }
    vi.doMock('../../server/utils/db', () => ({ getD1: () => d1 }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    await generateD1SqlDump(mkEvent())
    expect(sqliteMasterQuery).toContain('_cf')
    expect(sqliteMasterQuery.toLowerCase()).toContain('not like')
  })

  it('rejects a table/column name outside the safe-identifier pattern', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        'bad; drop table sites;--': {
          schema: 'CREATE TABLE "whatever" (id TEXT)',
          rows: [],
        },
      }),
    }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    await expect(generateD1SqlDump(mkEvent())).rejects.toThrow(/unexpected identifier/i)
  })

  it('backs off the page size and retries the same offset on an isolate-memory rejection', async () => {
    // Simulates the real production failure this was built for: a page of 1000 rows
    // overflows D1's per-isolate memory ceiling on a table with large rows. The fetch
    // loop should quarter the page size and retry the *same* offset rather than giving
    // up or advancing past unread rows.
    vi.resetModules()
    const limitsSeen: number[] = []
    const d1 = {
      prepare(sql: string) {
        const stmt = {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) { stmt.params = params; return stmt },
          async all() {
            if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) {
              return {
                results: [{ type: 'table', name: 'big', sql: 'CREATE TABLE "big" ("id" TEXT)' }],
                success: true,
                meta: {},
              }
            }
            if (sql.startsWith('SELECT COUNT(*)')) {
              return { results: [{ c: 2 }], success: true, meta: {} }
            }
            const [limit, offset] = stmt.params as [number, number]
            limitsSeen.push(limit)
            if (limit === 1000) {
              throw new Error("D1_ERROR: D1 DB's isolate exceeded its memory limit and was reset.")
            }
            // Backed-off page size succeeds and returns fewer rows than requested,
            // confirming end-of-table on this first (and only) successful attempt.
            expect(offset).toBe(0)
            return { results: [{ id: 'row-0' }, { id: 'row-1' }], success: true, meta: {} }
          },
        }
        return stmt
      },
    }
    vi.doMock('../../server/utils/db', () => ({ getD1: () => d1 }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    const { rowCount, sql } = await generateD1SqlDump(mkEvent())

    expect(rowCount).toBe(2)
    expect(limitsSeen[0]).toBe(1000)
    expect(limitsSeen[1]).toBe(250) // 1000 / 4, per the module's backoff factor
    expect(sql).toContain('INSERT INTO "big"')
  })

  it('gives a clear terminal error when even the minimum page size still hits the isolate memory limit', async () => {
    vi.resetModules()
    const d1 = {
      prepare(sql: string) {
        const stmt = {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) { stmt.params = params; return stmt },
          async all() {
            if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) {
              return {
                results: [{ type: 'table', name: 'huge_rows', sql: 'CREATE TABLE "huge_rows" ("id" TEXT)' }],
                success: true,
                meta: {},
              }
            }
            if (sql.startsWith('SELECT COUNT(*)')) {
              return { results: [{ c: 500 }], success: true, meta: {} }
            }
            // Every SELECT attempt fails regardless of page size — even one row is too large.
            throw new Error("D1_ERROR: D1 DB's isolate exceeded its memory limit and was reset.")
          },
        }
        return stmt
      },
    }
    vi.doMock('../../server/utils/db', () => ({ getD1: () => d1 }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    await expect(generateD1SqlDump(mkEvent())).rejects.toMatchObject({
      statusCode: 413,
      message: expect.stringMatching(/huge_rows.*still exceeds D1's isolate memory limit even at 10 rows\/page/),
    })
  })

  it('stops with a clear error once the export exceeds its D1 query budget', async () => {
    // A table that never returns a short page (rows.length always equals the requested
    // page size) pages forever unless something stops it — the query budget is that
    // backstop, catching a pathologically large table before the export silently runs
    // out of Worker time/D1 queries mid-file.
    vi.resetModules()
    const d1 = {
      prepare(sql: string) {
        const stmt = {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) { stmt.params = params; return stmt },
          async all() {
            if (sql.startsWith('SELECT type, name, sql FROM sqlite_master')) {
              return {
                results: [{ type: 'table', name: 'endless', sql: 'CREATE TABLE "endless" ("id" TEXT)' }],
                success: true,
                meta: {},
              }
            }
            if (sql.startsWith('SELECT COUNT(*)')) {
              return { results: [{ c: 999999 }], success: true, meta: {} }
            }
            const [limit] = stmt.params as [number, number]
            return {
              results: Array.from({ length: limit }, (_, i) => ({ id: `row-${i}` })),
              success: true,
              meta: {},
            }
          },
        }
        return stmt
      },
    }
    vi.doMock('../../server/utils/db', () => ({ getD1: () => d1 }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    await expect(generateD1SqlDump(mkEvent())).rejects.toMatchObject({
      statusCode: 413,
      message: expect.stringMatching(/900-query budget/),
    })
  })

  it('labels which D1 step failed instead of surfacing a bare error', async () => {
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => ({
        prepare(sql: string) {
          return {
            sql,
            bind() { return this },
            async all() { throw new Error('D1_ERROR: not authorized: SQLITE_AUTH') },
          }
        },
      }),
    }))
    const { generateD1SqlDump } = await import('../../server/utils/d1-export')

    await expect(generateD1SqlDump(mkEvent())).rejects.toThrow('[sqlite_master query] D1_ERROR: not authorized: SQLITE_AUTH')
  })

  it('streams row data via the write() callback instead of buffering it — never sends more than one page at a time', async () => {
    // The whole point of the prepareD1Dump()/streamD1TableData() split is that the live
    // HTTP export route (db-export.get.ts) never holds the full dump in memory — it wires
    // write() straight to the HTTP response body. Verify streamD1TableData() actually
    // calls write() progressively (multiple times, with growing content) rather than
    // producing one single giant chunk at the end, which is what generateD1SqlDump()'s
    // buffering wrapper does and must NOT be used for the live route.
    vi.resetModules()
    vi.doMock('../../server/utils/db', () => ({
      getD1: () => makeFakeD1({
        sites: {
          schema: 'CREATE TABLE "sites" ("id" TEXT)',
          rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        },
      }),
    }))
    const { prepareD1Dump, streamD1TableData } = await import('../../server/utils/d1-export')

    const prep = await prepareD1Dump(mkEvent())
    const chunks: string[] = []
    const { tableCount, rowCount } = await streamD1TableData(mkEvent(), prep.dataTables, (chunk) => {
      chunks.push(chunk)
    })

    expect(tableCount).toBe(1)
    expect(rowCount).toBe(3)
    // More than one write() call happened (the table comment, at minimum, is a separate
    // chunk from the INSERT statement) — confirms this is genuinely incremental, not one
    // write() at the very end with everything already assembled.
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.some(c => c.includes('-- Table: sites'))).toBe(true)
    expect(chunks.some(c => c.includes('INSERT INTO "sites"'))).toBe(true)
  })
})
