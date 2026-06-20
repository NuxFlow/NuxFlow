import { useDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { inArray, sql } from 'drizzle-orm'

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
  const raw = rawResults as unknown as { rows?: unknown[]; results?: unknown[] }
  const rows = (raw.rows ?? raw.results ?? []) as Record<string, unknown>[]

  if (!rows.length) return { results: [] }

  // Resolve slugs for all matched content items
  const ids = rows.map(r => String(r.content_item_id ?? ''))
  const slugMap = new Map<string, string>()

  if (ids.length > 0) {
    const items = await db
      .select({ id: contentItems.id, slug: contentItems.slug })
      .from(contentItems)
      .where(inArray(contentItems.id, ids))
    for (const item of items) slugMap.set(item.id, item.slug)
  }

  const results = rows.map(r => ({
    id: String(r.content_item_id ?? ''),
    title: String(r.title ?? ''),
    excerpt: String(r.excerpt ?? ''),
    slug: slugMap.get(String(r.content_item_id ?? '')) ?? null,
  }))

  return { results }
})
