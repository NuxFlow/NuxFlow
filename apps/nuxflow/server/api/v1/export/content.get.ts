import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { contentItems } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const format = (query.format as string) ?? 'json'

  // Capped rather than paginated — this is a "download everything" export, so silently
  // paging would drop content. The cap exists only to keep the response within the
  // isolate's memory ceiling on very large sites.
  const items = await db.query.contentItems.findMany({
    where: eq(contentItems.siteId, siteId),
    limit: 20_000,
  })

  if (format === 'csv') {
    const cols = ['id', 'title', 'slug', 'status', 'publishedAt', 'updatedAt'] as const
    const header = cols.join(',')
    const rows = items.map(i => cols.map(c => csvCell(i[c])).join(','))
    setHeader(event, 'Content-Type', 'text/csv')
    setHeader(event, 'Content-Disposition', 'attachment; filename="content-export.csv"')
    return [header, ...rows].join('\n')
  }

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Content-Disposition', 'attachment; filename="content-export.json"')
  return JSON.stringify(items)
})

// RFC 4180 quoting (embedded quotes are doubled, not backslash-escaped), plus a leading
// apostrophe on values a spreadsheet would otherwise evaluate as a formula — titles are
// author-controlled, and this file is opened by admins in Excel/Sheets.
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
