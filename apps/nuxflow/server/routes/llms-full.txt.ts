import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { contentItems, sites, users } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { pageToMarkdown } from '../utils/markdown'
import { getSeoSettings, siteBaseUrl, toIsoDateTime } from '../utils/seo'
import { getIndexableEntries } from '../utils/sitemap-entries'

// The whole site's readable content as one Markdown file (the llms-full.txt convention),
// newest first. Bounded two ways so a large site can't produce an unbounded response or an
// unbounded number of D1 reads: at most MAX_PAGES pages, and output stops once it passes
// MAX_BYTES (whole pages only — a page is never cut in half).
const MAX_PAGES = 500
const MAX_BYTES = 2_000_000
const CHUNK = 20

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const seo = await getSeoSettings(useReplicaDb(event), siteId)
  if (!seo.llmsEnabled || seo.aiCrawlers === 'disallow') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  setHeader(event, 'Content-Type', 'text/plain; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildLlmsFull(event))
})

async function buildLlmsFull(event: H3Event) {
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string

  const [site, seo] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true } }),
    getSeoSettings(db, siteId),
  ])
  const baseUrl = siteBaseUrl(seo, site?.domain, useRuntimeConfig().public.siteUrl as string)
  const { entries } = await getIndexableEntries(db, siteId, seo, MAX_PAGES)

  const header = `# ${site?.name ?? 'NuxFlow'}\n\n> ${(seo.description || `Content published by ${site?.name ?? 'this site'}`).replace(/\s+/g, ' ')}\n`
  const docs: string[] = [header]
  let bytes = header.length
  let included = 0

  outer:
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries.slice(i, i + CHUNK)
    const rows = await db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId), inArray(contentItems.id, batch.map(e => e.id))),
      columns: { id: true, content: true, authorId: true },
    })
    const authorIds = [...new Set(rows.map(r => r.authorId).filter((x): x is string => Boolean(x)))]
    const authors = authorIds.length
      ? await db.query.users.findMany({ where: inArray(users.id, authorIds), columns: { id: true, name: true } })
      : []
    const authorName = new Map(authors.map(a => [a.id, a.name]))
    const rowById = new Map(rows.map(r => [r.id, r]))

    for (const e of batch) {
      const row = rowById.get(e.id)
      if (!row) continue
      const md = pageToMarkdown({
        title: e.title,
        url: `${baseUrl}${e.path}`,
        description: e.description,
        author: row.authorId ? authorName.get(row.authorId) : null,
        locale: e.locale,
        publishedAt: toIsoDateTime(e.publishedAt),
        updatedAt: toIsoDateTime(e.updatedAt),
      }, row.content)
      if (bytes + md.length > MAX_BYTES && included > 0) break outer
      docs.push(md)
      bytes += md.length
      included++
    }
  }

  if (included < entries.length) {
    docs.push(`<!-- ${entries.length - included} more pages omitted to keep this file under ${Math.round(MAX_BYTES / 1_000_000)} MB — see ${baseUrl}/sitemap.xml -->\n`)
  }
  return docs.join('\n\n')
}
