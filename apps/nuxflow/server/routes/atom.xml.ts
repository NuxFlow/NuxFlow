import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { getFeedSite, getPublishedPostsForFeed } from '@nuxflow/db/queries'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml, cdataSafe } from '../utils/xml'
import { withPublicPaths } from '../utils/seo'
import { renderTipTap } from '../../shared/lib/render-tiptap'
import { absolutizeHtmlUrls } from '../utils/media-url'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/atom+xml; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildAtomFeed(event))
})

async function buildAtomFeed(event: H3Event) {
  // Anonymous, read-only, edge-cached — safe to read from a D1 read replica when one is
  // enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const [site, posts] = await Promise.all([
    getFeedSite(db, siteId),
    getPublishedPostsForFeed(db, siteId),
  ])
  const baseUrl = site ? `https://${site.domain}` : config.public.siteUrl as string

  const updated = posts[0]?.updatedAt ?? new Date().toISOString()

  const entries = (await withPublicPaths(db, siteId, posts)).map((p) => {
    const contentObj = p.content as Record<string, unknown> | null
    const isCanvas = contentObj?.type === 'canvas'
    const html = !isCanvas && contentObj ? absolutizeHtmlUrls(renderTipTap(contentObj), baseUrl) : ''
    const url = `${baseUrl}${p.path}`
    const pub = new Date(p.publishedAt ?? p.updatedAt).toISOString()
    const mod = new Date(p.updatedAt).toISOString()
    return `  <entry>
    <title>${escXml(p.title)}</title>
    <link href="${escXml(url)}" />
    <id>${escXml(url)}</id>
    <published>${pub}</published>
    <updated>${mod}</updated>
    ${p.excerpt ? `<summary type="text">${escXml(p.excerpt)}</summary>` : ''}
    ${html ? `<content type="html"><![CDATA[${cdataSafe(html)}]]></content>` : ''}
    ${p.authorName ? `<author><name>${escXml(p.authorName)}</name></author>` : ''}
  </entry>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escXml(site?.name ?? 'NuxFlow')}</title>
  <link href="${escXml(baseUrl)}" />
  <link rel="self" type="application/atom+xml" href="${escXml(baseUrl)}/atom.xml" />
  <id>${escXml(baseUrl)}/</id>
  <updated>${new Date(updated).toISOString()}</updated>
${entries}
</feed>`
}
