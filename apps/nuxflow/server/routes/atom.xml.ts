import { useDb } from '../utils/db'
import { contentItems, sites, users } from '@nuxflow/db/schema'
import { and, desc, eq } from 'drizzle-orm'

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function tiptapToHtml(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  const children = (n.content as unknown[] | undefined)?.map(tiptapToHtml).join('') ?? ''
  const rawText = n.text as string | undefined
  let result = rawText ? escXml(rawText) : children
  if (rawText && Array.isArray(n.marks)) {
    for (const mark of n.marks as Record<string, unknown>[]) {
      const attrs = (mark.attrs as Record<string, string>) ?? {}
      switch (mark.type) {
        case 'bold': result = `<strong>${result}</strong>`; break
        case 'italic': result = `<em>${result}</em>`; break
        case 'code': result = `<code>${result}</code>`; break
        case 'link': result = `<a href="${escXml(attrs.href ?? '')}">${result}</a>`; break
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
    case 'image': return `<img src="${escXml(String(attrs.src ?? ''))}" alt="${escXml(String(attrs.alt ?? ''))}">`
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

  const baseUrl = site ? `https://${site.domain}` : config.public.siteUrl as string

  const posts = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      slug: contentItems.slug,
      excerpt: contentItems.excerpt,
      content: contentItems.content,
      ogImage: contentItems.ogImage,
      publishedAt: contentItems.publishedAt,
      updatedAt: contentItems.updatedAt,
      authorName: users.name,
    })
    .from(contentItems)
    .leftJoin(users, eq(contentItems.authorId, users.id))
    .where(and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')))
    .orderBy(desc(contentItems.publishedAt))
    .limit(20)

  const updated = posts[0]?.updatedAt ?? new Date().toISOString()

  const entries = posts.map((p) => {
    const contentObj = p.content as Record<string, unknown> | null
    const isCanvas = contentObj?.type === 'canvas'
    const html = !isCanvas && contentObj ? tiptapToHtml(contentObj) : ''
    const url = `${baseUrl}/${p.slug}`
    const pub = new Date(p.publishedAt ?? p.updatedAt).toISOString()
    const mod = new Date(p.updatedAt).toISOString()
    return `  <entry>
    <title>${escXml(p.title)}</title>
    <link href="${escXml(url)}" />
    <id>${escXml(url)}</id>
    <published>${pub}</published>
    <updated>${mod}</updated>
    ${p.excerpt ? `<summary type="text">${escXml(p.excerpt)}</summary>` : ''}
    ${html ? `<content type="html"><![CDATA[${html}]]></content>` : ''}
    ${p.authorName ? `<author><name>${escXml(p.authorName)}</name></author>` : ''}
  </entry>`
  }).join('\n')

  setHeader(event, 'Content-Type', 'application/atom+xml; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escXml(site?.name ?? 'NuxFlow')}</title>
  <link href="${escXml(baseUrl)}" />
  <link rel="self" type="application/atom+xml" href="${escXml(baseUrl)}/atom.xml" />
  <id>${escXml(baseUrl)}/</id>
  <updated>${new Date(updated).toISOString()}</updated>
${entries}
</feed>`
})
