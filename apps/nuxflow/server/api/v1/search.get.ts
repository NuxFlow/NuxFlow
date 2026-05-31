import { useDb } from '../../utils/db'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const q = (query.q as string)?.trim()

  if (!q || q.length < 2 || q.length > 200) return { results: [] }

  const db = useDb(event)

  // FTS5 query — sanitise input by stripping special chars
  const safe = q.replace(/[^a-z0-9 ]/gi, '') + '*'

  const rawResults = await db.run(sql`
    SELECT content_item_id, title, snippet(search_index, 2, '<mark>', '</mark>', '…', 20) AS excerpt
    FROM search_index
    WHERE search_index MATCH ${safe}
      AND site_id = ${siteId}
    ORDER BY rank
    LIMIT 20
  `)

  // D1 returns { results: [{...}] }, LibSQL returns { rows: [[...]] }
  // The drizzle `.run()` return type differs by adapter; cast through unknown to access both shapes.
  const raw = rawResults as unknown as { rows?: unknown[]; results?: unknown[] }
  const rows: unknown[] = raw.rows ?? raw.results ?? []
  return { results: rows }
})
