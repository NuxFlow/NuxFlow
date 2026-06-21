import { sendStream } from 'h3'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { contentTypes, contentItems, taxonomies, taxonomyTerms, contentTaxonomyTerms, media } from '@nuxflow/db/schema'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { isSafeUrl } from '../../../utils/security'

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

type ImportEvent =
  | { type: 'parsed'; items: number; images: number }
  | { type: 'media'; done: number; total: number; failed: number }
  | { type: 'content_start'; total: number }
  | { type: 'content'; done: number; total: number }
  | { type: 'done'; imported: number; skipped: number; categories: number; tags: number; mediaUploaded: number; mediaFailed: number }
  | { type: 'error'; message: string }

function parseWxr(xml: string): { items: WpItem[]; attachments: WpAttachment[]; categories: Map<string, string>; tags: Map<string, string> } {
  const items: WpItem[] = []
  const attachments: WpAttachment[] = []
  const categories = new Map<string, string>()
  const tags = new Map<string, string>()

  const catRegex = /<wp:category>[\s\S]*?<wp:category_nicename><!\[CDATA\[(.*?)\]\]><\/wp:category_nicename>[\s\S]*?<wp:cat_name><!\[CDATA\[(.*?)\]\]><\/wp:cat_name>[\s\S]*?<\/wp:category>/g
  for (const m of xml.matchAll(catRegex)) {
    categories.set(m[1]!, m[2]!)
  }

  const tagRegex = /<wp:tag>[\s\S]*?<wp:tag_slug><!\[CDATA\[(.*?)\]\]><\/wp:tag_slug>[\s\S]*?<wp:tag_name><!\[CDATA\[(.*?)\]\]><\/wp:tag_name>[\s\S]*?<\/wp:tag>/g
  for (const m of xml.matchAll(tagRegex)) {
    tags.set(m[1]!, m[2]!)
  }

  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  for (const itemMatch of xml.matchAll(itemRegex)) {
    const block = itemMatch[1]!
    const postType = cdataOrTag(block, 'wp:post_type') ?? 'post'

    if (postType === 'attachment') {
      const title = cdataOrTag(block, 'title') ?? ''
      const slug = cdataOrTag(block, 'wp:post_name') ?? slugify(title)
      const url = cdataOrTag(block, 'wp:attachment_url')
      if (url) attachments.push({ title, slug, url })
      continue
    }

    if (postType !== 'post' && postType !== 'page') continue

    const title = cdataOrTag(block, 'title') ?? ''
    const slug = cdataOrTag(block, 'wp:post_name') ?? slugify(title)
    const rawStatus = cdataOrTag(block, 'wp:status') ?? 'draft'
    const status = rawStatus === 'publish' ? 'published' : 'draft'
    const content = cdataOrTag(block, 'content:encoded') ?? ''
    const excerpt = cdataOrTag(block, 'excerpt:encoded') ?? ''
    const pubDate = cdataOrTag(block, 'wp:post_date_gmt') ?? null

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
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: html }] }],
  }
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const provider = await getActiveProvider(event)

  const formData = await readMultipartFormData(event)
  const xmlFile = formData?.find(f => f.name === 'file')
  if (!xmlFile) throw createError({ statusCode: 400, message: 'No file uploaded' })

  const xml = new TextDecoder().decode(xmlFile.data)
  const { items, attachments, categories, tags } = parseWxr(xml)

  // Collect all unique image URLs up front (attachments + inline <img> tags)
  const allImageUrls = new Set<string>()
  for (const att of attachments) {
    if (isSafeUrl(att.url)) allImageUrls.add(att.url)
  }
  for (const item of items) {
    for (const m of item.content.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/g)) {
      if (isSafeUrl(m[1]!)) allImageUrls.add(m[1]!)
    }
  }
  const imageUrls = [...allImageUrls]

  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const enc = new TextEncoder()

  const push = (data: ImportEvent) =>
    writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`))

  ;(async () => {
    try {
      await push({ type: 'parsed', items: items.length, images: imageUrls.length })

      // Phase 1: upload all images in parallel batches of 10
      const urlMap = new Map<string, string>()
      const BATCH = 10
      let mediaDone = 0
      let mediaFailed = 0

      for (let i = 0; i < imageUrls.length; i += BATCH) {
        const batch = imageUrls.slice(i, i + BATCH)

        const results = await Promise.allSettled(
          batch.map(async (remoteUrl) => {
            const res = await fetch(remoteUrl)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const buffer = await res.arrayBuffer()
            const contentType = res.headers.get('content-type') ?? 'image/jpeg'
            const fileId = ulid()
            const rawName = remoteUrl.split('/').pop()?.split('?')[0] ?? `${fileId}.jpg`
            const ext = rawName.split('.').pop() ?? 'jpg'
            const storageKey = `${siteId}/${fileId}.${ext}`
            const file = new File([buffer], rawName, { type: contentType })
            const { url: localUrl } = await provider.upload(file, storageKey, siteId)
            await db.insert(media).values({
              id: fileId,
              siteId,
              uploadedBy: userId,
              filename: storageKey,
              originalName: rawName,
              mimeType: contentType,
              size: buffer.byteLength,
              url: localUrl,
              storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
              storageKey,
            })
            return { remoteUrl, localUrl }
          }),
        )

        for (const r of results) {
          if (r.status === 'fulfilled') {
            urlMap.set(r.value.remoteUrl, r.value.localUrl)
            mediaDone++
          }
          else {
            mediaFailed++
            mediaDone++
          }
        }

        await push({ type: 'media', done: mediaDone, total: imageUrls.length, failed: mediaFailed })
      }

      // Phase 2: ensure content types and taxonomies exist
      const pageType = await db.query.contentTypes.findFirst({
        where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'page')),
      })
      const postType = await db.query.contentTypes.findFirst({
        where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'post')),
      })
      if (!pageType || !postType)
        throw createError({ statusCode: 422, message: 'Content types not found — run setup first' })

      let catTaxonomy = await db.query.taxonomies.findFirst({
        where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, 'category')),
      })
      if (!catTaxonomy) {
        const id = ulid()
        await db.insert(taxonomies).values({ id, siteId, slug: 'category', name: 'Categories', isHierarchical: true })
        catTaxonomy = { id, siteId, slug: 'category', name: 'Categories', isHierarchical: true, createdAt: '' }
      }

      let tagTaxonomy = await db.query.taxonomies.findFirst({
        where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, 'post_tag')),
      })
      if (!tagTaxonomy) {
        const id = ulid()
        await db.insert(taxonomies).values({ id, siteId, slug: 'post_tag', name: 'Tags', isHierarchical: false })
        tagTaxonomy = { id, siteId, slug: 'post_tag', name: 'Tags', isHierarchical: false, createdAt: '' }
      }

      const catTermMap = new Map<string, string>()
      for (const [slug, name] of categories) {
        const existing = await db.query.taxonomyTerms.findFirst({
          where: and(eq(taxonomyTerms.taxonomyId, catTaxonomy.id), eq(taxonomyTerms.slug, slug)),
        })
        if (existing) { catTermMap.set(slug, existing.id); continue }
        const id = ulid()
        await db.insert(taxonomyTerms).values({ id, taxonomyId: catTaxonomy.id, slug, name })
        catTermMap.set(slug, id)
      }

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

      await push({ type: 'content_start', total: items.length })

      // Phase 3: import content items with URL rewriting applied from completed urlMap
      let imported = 0
      let skipped = 0

      for (const item of items) {
        const typeId = item.postType === 'page' ? pageType.id : postType.id
        const itemId = ulid()

        const existing = await db.query.contentItems.findFirst({
          where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, item.slug)),
          columns: { id: true },
        })
        if (existing) { skipped++; continue }

        let content = item.content
        for (const [remoteUrl, localUrl] of urlMap.entries()) {
          content = content.replaceAll(remoteUrl, localUrl)
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
        if (imported % 10 === 0) {
          await push({ type: 'content', done: imported + skipped, total: items.length })
        }
      }

      await push({
        type: 'done',
        imported,
        skipped,
        categories: categories.size,
        tags: tags.size,
        mediaUploaded: mediaDone - mediaFailed,
        mediaFailed,
      })
    }
    catch (err) {
      await push({ type: 'error', message: err instanceof Error ? err.message : 'Import failed' }).catch(() => {})
    }
    finally {
      await writer.close().catch(() => {})
    }
  })()

  return sendStream(event, readable)
})
