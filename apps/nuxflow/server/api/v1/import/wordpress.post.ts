import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { contentTypes, contentItems, taxonomies, taxonomyTerms, contentTaxonomyTerms, media } from '@nuxflow/db/schema'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

interface WpItem {
  title: string
  slug: string
  status: string
  postType: string
  content: string
  excerpt: string
  publishedAt: string | null
  categories: string[]
  tags: string[]
}

interface WpAttachment {
  title: string
  slug: string
  url: string
}

function parseWxr(xml: string): { items: WpItem[]; attachments: WpAttachment[]; categories: Map<string, string>; tags: Map<string, string> } {
  const items: WpItem[] = []
  const attachments: WpAttachment[] = []
  const categories = new Map<string, string>()
  const tags = new Map<string, string>()

  // Parse wp:category elements (site-level taxonomy terms)
  const catRegex = /<wp:category>[\s\S]*?<wp:category_nicename><!\[CDATA\[(.*?)\]\]><\/wp:category_nicename>[\s\S]*?<wp:cat_name><!\[CDATA\[(.*?)\]\]><\/wp:cat_name>[\s\S]*?<\/wp:category>/g
  for (const m of xml.matchAll(catRegex)) {
    categories.set(m[1]!, m[2]!)
  }

  // Parse wp:tag elements
  const tagRegex = /<wp:tag>[\s\S]*?<wp:tag_slug><!\[CDATA\[(.*?)\]\]><\/wp:tag_slug>[\s\S]*?<wp:tag_name><!\[CDATA\[(.*?)\]\]><\/wp:tag_name>[\s\S]*?<\/wp:tag>/g
  for (const m of xml.matchAll(tagRegex)) {
    tags.set(m[1]!, m[2]!)
  }

  // Parse <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  for (const itemMatch of xml.matchAll(itemRegex)) {
    const block = itemMatch[1]!

    const postType = cdataOrTag(block, 'wp:post_type') ?? 'post'
    if (postType === 'attachment') {
      const title = cdataOrTag(block, 'title') ?? ''
      const slug = cdataOrTag(block, 'wp:post_name') ?? slugify(title)
      const url = cdataOrTag(block, 'wp:attachment_url')
      if (url) {
        attachments.push({ title, slug, url })
      }
      continue
    }

    if (postType !== 'post' && postType !== 'page') continue

    const title = cdataOrTag(block, 'title') ?? ''
    const slug = cdataOrTag(block, 'wp:post_name') ?? slugify(title)
    const rawStatus = cdataOrTag(block, 'wp:status') ?? 'draft'
    const status = rawStatus === 'publish' ? 'published' : rawStatus === 'draft' ? 'draft' : 'draft'
    const content = cdataOrTag(block, 'content:encoded') ?? ''
    const excerpt = cdataOrTag(block, 'excerpt:encoded') ?? ''
    const pubDate = cdataOrTag(block, 'wp:post_date_gmt') ?? null

    // Collect category/tag slugs assigned to this item
    const itemCats: string[] = []
    const itemTags: string[] = []
    const termRegex = /<category domain="(category|post_tag)" nicename="([^"]+)"/g
    for (const tm of block.matchAll(termRegex)) {
      if (tm[1] === 'category') itemCats.push(tm[2]!)
      else itemTags.push(tm[2]!)
    }

    items.push({ title, slug, status, postType, content, excerpt, publishedAt: pubDate, categories: itemCats, tags: itemTags })
  }

  return { items, attachments, categories, tags }
}

function cdataOrTag(block: string, tag: string): string | null {
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`)
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`)
  const cm = block.match(cdataRe)
  if (cm) return cm[1]!.trim()
  const pm = block.match(plainRe)
  return pm ? pm[1]!.trim() : null
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ulid().toLowerCase()
}

function wpContentToTipTap(html: string): object {
  // Wrap raw WordPress HTML in a TipTap doc; browsers/TipTap will parse it client-side.
  // We store as a minimal doc wrapping the HTML in a paragraph so it's not lost.
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: html }] }],
  }
}

function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }
    const host = url.hostname.toLowerCase()

    // Block localhost / loopback
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
      return false
    }

    // Block ending in internal/local
    if (host.endsWith('.local') || host.endsWith('.internal')) {
      return false
    }

    // Parse literal IP blocks
    // Regular expression for private IPv4 addresses:
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    const ipv4PrivateRegex = /^(?:10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/
    if (ipv4PrivateRegex.test(host)) {
      return false
    }

    // Basic IPv6 private check: fc00::/7 (unique local), fe80::/10 (link local)
    if (host.startsWith('fc00:') || host.startsWith('fd00:') || host.startsWith('fe80:')) {
      return false
    }

    return true
  } catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const formData = await readMultipartFormData(event)
  const xmlFile = formData?.find(f => f.name === 'file')
  if (!xmlFile) throw createError({ statusCode: 400, message: 'No file uploaded' })

  const xml = new TextDecoder().decode(xmlFile.data)
  const { items, attachments, categories, tags } = parseWxr(xml)

  // Ensure content types exist
  const pageType = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'page')),
  })
  const postType = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'post')),
  })
  if (!pageType || !postType) throw createError({ statusCode: 422, message: 'Content types not found — run setup first' })

  // Upsert Categories taxonomy
  let catTaxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, 'category')),
  })
  if (!catTaxonomy) {
    const id = ulid()
    await db.insert(taxonomies).values({ id, siteId, slug: 'category', name: 'Categories', isHierarchical: true })
    catTaxonomy = { id, siteId, slug: 'category', name: 'Categories', isHierarchical: true, createdAt: '' }
  }

  // Upsert Tags taxonomy
  let tagTaxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, 'post_tag')),
  })
  if (!tagTaxonomy) {
    const id = ulid()
    await db.insert(taxonomies).values({ id, siteId, slug: 'post_tag', name: 'Tags', isHierarchical: false })
    tagTaxonomy = { id, siteId, slug: 'post_tag', name: 'Tags', isHierarchical: false, createdAt: '' }
  }

  // Insert all category terms
  const catTermMap = new Map<string, string>() // slug -> id
  for (const [slug, name] of categories) {
    const existing = await db.query.taxonomyTerms.findFirst({
      where: and(eq(taxonomyTerms.taxonomyId, catTaxonomy.id), eq(taxonomyTerms.slug, slug)),
    })
    if (existing) { catTermMap.set(slug, existing.id); continue }
    const id = ulid()
    await db.insert(taxonomyTerms).values({ id, taxonomyId: catTaxonomy.id, slug, name })
    catTermMap.set(slug, id)
  }

  // Insert all tag terms
  const tagTermMap = new Map<string, string>()
  for (const [slug, name] of tags) {
    const existing = await db.query.taxonomyTerms.findFirst({
      where: and(eq(taxonomyTerms.taxonomyId, tagTaxonomy.id), eq(taxonomyTerms.slug, slug)),
    })
    if (existing) { tagTermMap.set(slug, existing.id); continue }
    const id = ulid()
    await db.insert(taxonomyTerms).values({ id, taxonomyId: tagTaxonomy.id, slug, name })
    tagTermMap.set(slug, id)
  }

  // Ingest attachments and build URL mapping
  const urlMap = new Map<string, string>()
  const provider = getActiveProvider()

  for (const att of attachments) {
    if (!isSafeUrl(att.url)) continue

    try {
      const res = await fetch(att.url)
      if (!res.ok) continue
      const buffer = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') || 'image/jpeg'

      const fileId = ulid()
      const filename = att.url.split('/').pop() || `${fileId}.jpg`
      const ext = filename.split('.').pop() || 'jpg'
      const storageKey = `${siteId}/${fileId}.${ext}`

      const file = new File([buffer], filename, { type: contentType })
      const { url: localUrl } = await provider.upload(file, storageKey, siteId)

      await db.insert(media).values({
        id: fileId,
        siteId,
        uploadedBy: userId,
        filename: storageKey,
        originalName: filename,
        mimeType: contentType,
        size: buffer.byteLength,
        url: localUrl,
        storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
        storageKey,
      })

      urlMap.set(att.url, localUrl)
    } catch (err) {
      console.error(`Failed to ingest remote attachment ${att.url}:`, err)
    }
  }

  let imported = 0
  let skipped = 0

  for (const item of items) {
    const typeId = item.postType === 'page' ? pageType.id : postType.id
    const itemId = ulid()

    // Skip duplicate slugs
    const existing = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, item.slug)),
      columns: { id: true },
    })
    if (existing) { skipped++; continue }

    // Rewrite remote image URLs using parsed attachments or inline images scraped from content
    let content = item.content

    // 1. Rewrite using known attachments
    for (const [remoteUrl, localUrl] of urlMap.entries()) {
      content = content.replaceAll(remoteUrl, localUrl)
    }

    // 2. Scrape and ingest any remaining inline public image sources
    const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/g
    for (const imgMatch of content.matchAll(imgRegex)) {
      const remoteUrl = imgMatch[1]!
      if (urlMap.has(remoteUrl)) continue
      if (!isSafeUrl(remoteUrl)) continue

      try {
        const res = await fetch(remoteUrl)
        if (!res.ok) continue
        const buffer = await res.arrayBuffer()
        const contentType = res.headers.get('content-type') || 'image/jpeg'

        const fileId = ulid()
        const filename = remoteUrl.split('/').pop() || `${fileId}.jpg`
        const ext = filename.split('.').pop() || 'jpg'
        const storageKey = `${siteId}/${fileId}.${ext}`

        const file = new File([buffer], filename, { type: contentType })
        const { url: localUrl } = await provider.upload(file, storageKey, siteId)

        await db.insert(media).values({
          id: fileId,
          siteId,
          uploadedBy: userId,
          filename: storageKey,
          originalName: filename,
          mimeType: contentType,
          size: buffer.byteLength,
          url: localUrl,
          storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
          storageKey,
        })

        urlMap.set(remoteUrl, localUrl)
        content = content.replaceAll(remoteUrl, localUrl)
      } catch (err) {
        console.error(`Failed to ingest remote inline image ${remoteUrl}:`, err)
      }
    }

    await db.insert(contentItems).values({
      id: itemId,
      siteId,
      typeId,
      slug: item.slug,
      title: item.title || '(Untitled)',
      status: item.status as 'draft' | 'published',
      content: wpContentToTipTap(content),
      excerpt: item.excerpt || null,
      publishedAt: item.publishedAt,
    })

    // Assign taxonomy terms
    const termIds: string[] = []
    for (const catSlug of item.categories) {
      const tid = catTermMap.get(catSlug)
      if (tid) termIds.push(tid)
    }
    for (const tagSlug of item.tags) {
      const tid = tagTermMap.get(tagSlug)
      if (tid) termIds.push(tid)
    }
    if (termIds.length > 0) {
      await db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: itemId, termId })))
    }

    imported++
  }

  return { imported, skipped, categories: categories.size, tags: tags.size, mediaUploaded: urlMap.size }
})
