import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { getFeedSite, getPublishedPostsForFeed } from '@nuxflow/db/queries'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml, cdataSafe } from '../utils/xml'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Blocks javascript:/vbscript:/data: URIs in href/src — escHtml() only escapes HTML
// metacharacters, it doesn't stop a scheme that executes on click (link) or load (image).
// Mirrors app/utils/render-tiptap.ts's escUrl(); duplicated here since that file is
// scoped to the Vue app bundle and can't be imported from Nitro server routes.
function escUrl(s: string) {
  const trimmed = s.trim()
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return ''
  return escHtml(s)
}

function tiptapToHtml(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  const children = (n.content as unknown[] | undefined)?.map(tiptapToHtml).join('') ?? ''
  const rawText = n.text as string | undefined

  let result = rawText ? escHtml(rawText) : children

  if (rawText && Array.isArray(n.marks)) {
    for (const mark of n.marks as Record<string, unknown>[]) {
      const attrs = (mark.attrs as Record<string, string>) ?? {}
      switch (mark.type) {
        case 'bold': result = `<strong>${result}</strong>`; break
        case 'italic': result = `<em>${result}</em>`; break
        case 'code': result = `<code>${result}</code>`; break
        case 'underline': result = `<u>${result}</u>`; break
        case 'strike': result = `<s>${result}</s>`; break
        case 'link': result = `<a href="${escUrl(attrs.href ?? '')}">${result}</a>`; break
      }
    }
  }

  const attrs = (n.attrs as Record<string, unknown>) ?? {}
  switch (n.type) {
    case 'doc': return result
    case 'paragraph': return `<p>${result}</p>`
    case 'heading': return `<h${attrs.level}>${result}</h${attrs.level}>`
    case 'bulletList': return `<ul>${result}</ul>`
    case 'orderedList': return `<ol>${result}</ol>`
    case 'listItem': return `<li>${result}</li>`
    case 'blockquote': return `<blockquote>${result}</blockquote>`
    case 'codeBlock': return `<pre><code>${result}</code></pre>`
    case 'hardBreak': return '<br>'
    case 'horizontalRule': return '<hr>'
    case 'image': return `<img src="${escUrl(String(attrs.src ?? ''))}" alt="${escHtml(String(attrs.alt ?? ''))}">`
    default: return result
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/rss+xml; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildFeed(event))
})

async function buildFeed(event: H3Event) {
  // Anonymous, read-only, edge-cached — safe to read from a D1 read replica when one is
  // enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const [site, posts] = await Promise.all([
    getFeedSite(db, siteId),
    getPublishedPostsForFeed(db, siteId),
  ])
  const baseUrl = escXml(site ? `https://${site.domain}` : config.public.siteUrl)
  const siteName = escXml(site?.name ?? 'NuxFlow')

  const items = posts.map((p) => {
    const contentObj = p.content as Record<string, unknown> | null
    const isCanvas = contentObj?.type === 'canvas'
    const fullHtml = !isCanvas && contentObj ? tiptapToHtml(contentObj) : ''
    const summary = p.excerpt ?? ''
    const itemUrl = `${baseUrl}/${escXml(p.slug)}`
    return `
    <item>
      <title><![CDATA[${cdataSafe(p.title)}]]></title>
      <link>${itemUrl}</link>
      <guid isPermaLink="true">${itemUrl}</guid>
      <pubDate>${new Date(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>
      ${summary ? `<description><![CDATA[${cdataSafe(summary)}]]></description>` : ''}
      ${fullHtml ? `<content:encoded><![CDATA[${cdataSafe(fullHtml)}]]></content:encoded>` : ''}
      ${p.authorName ? `<author>${escXml(p.authorName)}</author>` : ''}
      ${p.ogImage ? `<media:thumbnail url="${escXml(p.ogImage)}" /><media:content url="${escXml(p.ogImage)}" medium="image" />` : ''}
    </item>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${siteName}</title>
    <link>${baseUrl}</link>
    <description>Latest posts from ${siteName}</description>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml" />
    <atom:link href="${baseUrl}/atom.xml" rel="alternate" type="application/atom+xml" />
    ${items}
  </channel>
</rss>`
}
