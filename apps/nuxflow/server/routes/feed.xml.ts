import { useDb } from '../utils/db'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
        case 'link': result = `<a href="${escHtml(attrs.href ?? '')}">${result}</a>`; break
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
    case 'image': return `<img src="${escHtml(String(attrs.src ?? ''))}" alt="${escHtml(String(attrs.alt ?? ''))}">`
    default: return result
  }
}

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true },
  })

  const baseUrl = site ? `https://${site.domain}` : config.public.siteUrl

  const posts = await db.query.contentItems.findMany({
    where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published')),
    orderBy: [desc(contentItems.publishedAt)],
    limit: 20,
    columns: { id: true, title: true, slug: true, excerpt: true, content: true, publishedAt: true, updatedAt: true },
  })

  const items = posts.map((p) => {
    const contentObj = p.content as Record<string, unknown> | null
    const isCanvas = contentObj?.type === 'canvas'
    const fullHtml = !isCanvas && contentObj ? tiptapToHtml(contentObj) : ''
    const desc = p.excerpt ?? (fullHtml ? '' : '')
    return `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${baseUrl}/${p.slug}</link>
      <guid isPermaLink="true">${baseUrl}/${p.slug}</guid>
      <pubDate>${new Date(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>
      ${desc ? `<description><![CDATA[${desc}]]></description>` : ''}
      ${fullHtml ? `<content:encoded><![CDATA[${fullHtml}]]></content:encoded>` : ''}
    </item>`
  }).join('')

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=UTF-8')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${site?.name ?? 'NuxFlow'}</title>
    <link>${baseUrl}</link>
    <description>Latest posts from ${site?.name ?? 'NuxFlow'}</description>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`
})
