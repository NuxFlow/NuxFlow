import { sendStream } from 'h3'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { contentTypes, contentItems, taxonomies, taxonomyContentTypes, taxonomyTerms, contentTaxonomyTerms, media } from '@nuxflow/db/schema'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { isSafeUrl, safeFetch } from '../../../utils/ssrf'
import { errorMessage } from '../../../utils/errors'
import { htmlToTipTap } from '../../../utils/html-to-tiptap'
import { parseWxr } from '../../../utils/wxr-parser'
import { slugify } from '../../../utils/taxonomy'
import { writeAuditLog } from '../../../utils/audit'

const MAX_WXR_BYTES = 100 * 1024 * 1024 // 100 MB — WXR exports for large sites can be tens of MB

type ImportEvent =
  | { type: 'parsed'; items: number; images: number }
  | { type: 'media'; done: number; total: number; failed: number }
  | { type: 'content_start'; total: number }
  | { type: 'content'; done: number; total: number }
  | { type: 'done'; imported: number; skipped: number; categories: number; tags: number; mediaUploaded: number; mediaFailed: number }
  | { type: 'error'; message: string }

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const provider = await getActiveProvider(event)

  const formData = await readMultipartFormData(event)
  const xmlFile = formData?.find(f => f.name === 'file')
  if (!xmlFile) throw badRequest('No file uploaded')
  if (xmlFile.data.byteLength > MAX_WXR_BYTES) {
    throw createError({ statusCode: 413, message: 'WXR file exceeds 100 MB limit' })
  }

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
            const res = await safeFetch(remoteUrl)
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
        throw validationError('Content types not found — run setup first')

      const ensureTaxonomy = async (slug: string, name: string, isHierarchical: boolean) => {
        const existing = await db.query.taxonomies.findFirst({
          where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, slug)),
          columns: { id: true },
        })
        if (existing) return existing.id
        const id = ulid()
        await db.insert(taxonomies).values({ id, siteId, slug, name, isHierarchical })
        // WordPress categories/tags are post taxonomies.
        await db.insert(taxonomyContentTypes).values({ taxonomyId: id, contentTypeId: postType.id })
        return id
      }
      const catTaxonomyId = await ensureTaxonomy('category', 'Categories', true)
      const tagTaxonomyId = await ensureTaxonomy('tag', 'Tags', false)

      // WordPress nicenames aren't valid NuxFlow slugs as-is: non-Latin names are stored
      // percent-encoded (%e6%97%a5…) and older exports can carry uppercase. Map each
      // nicename to a clean, unique slug within its taxonomy, keyed by the original so
      // item assignments and parent links still resolve.
      const buildSlugMap = (entries: [string, string][]) => {
        const out = new Map<string, string>()
        const used = new Set<string>()
        for (const [nicename, name] of entries) {
          let decoded = nicename
          try { decoded = decodeURIComponent(nicename) } catch { /* keep as-is */ }
          const base = slugify(decoded) || slugify(name) || 'term'
          let slug = base
          for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
          used.add(slug)
          out.set(nicename, slug)
        }
        return out
      }
      const catSlugByNicename = buildSlugMap([...categories].map(([k, v]) => [k, v.name]))
      const tagSlugByNicename = buildSlugMap([...tags])

      // One prefetch instead of one findFirst() per term — a WXR export can carry
      // hundreds of categories.
      const prefetch = async (taxonomyId: string, slugs: string[]) => new Map(
        (slugs.length > 0
          ? await db.query.taxonomyTerms.findMany({
              where: and(eq(taxonomyTerms.taxonomyId, taxonomyId), inArray(taxonomyTerms.slug, slugs)),
              columns: { id: true, slug: true },
            })
          : []).map(t => [t.slug, t.id]),
      )
      const existingCats = await prefetch(catTaxonomyId, [...catSlugByNicename.values()])
      const catTermMap = new Map<string, string>() // nicename -> term id
      for (const [nicename, cat] of categories) {
        const slug = catSlugByNicename.get(nicename)!
        let id = existingCats.get(slug)
        if (!id) {
          id = ulid()
          await db.insert(taxonomyTerms).values({ id, taxonomyId: catTaxonomyId, slug, name: cat.name })
        }
        catTermMap.set(nicename, id)
      }

      // Second pass: wire parent categories now that every category has an id — WXR's
      // wp:category_parent references the parent by nicename/slug, so this can't be done
      // in the same pass as the insert loop above (the parent might not exist yet).
      for (const [nicename, cat] of categories) {
        if (!cat.parentSlug) continue
        const childId = catTermMap.get(nicename)
        const parentId = catTermMap.get(cat.parentSlug)
        // Only a category that is itself on the loop loses its parent; one merely nested
        // under a loop keeps it (valid once the loop's own links are skipped).
        let cyclic = false
        const seen = new Set<string>()
        for (let cursor: string | null | undefined = cat.parentSlug; cursor && !seen.has(cursor); cursor = categories.get(cursor)?.parentSlug) {
          if (cursor === nicename) {
            cyclic = true
            break
          }
          seen.add(cursor)
        }
        if (childId && parentId && !cyclic) {
          await db.update(taxonomyTerms).set({ parentId }).where(eq(taxonomyTerms.id, childId))
        }
      }

      const existingTags = await prefetch(tagTaxonomyId, [...tagSlugByNicename.values()])
      const tagTermMap = new Map<string, string>() // nicename -> term id
      for (const [nicename, name] of tags) {
        const slug = tagSlugByNicename.get(nicename)!
        let id = existingTags.get(slug)
        if (!id) {
          id = ulid()
          await db.insert(taxonomyTerms).values({ id, taxonomyId: tagTaxonomyId, slug, name })
        }
        tagTermMap.set(nicename, id)
      }

      // Attachment wp:post_id -> its (already-rewritten, if uploaded) local URL — used to
      // resolve each post's featured image (wp:postmeta _thumbnail_id references an
      // attachment by post id, not by URL).
      const attachmentUrlByPostId = new Map<string, string>()
      for (const att of attachments) {
        if (!att.postId) continue
        attachmentUrlByPostId.set(att.postId, urlMap.get(att.url) ?? att.url)
      }

      await push({ type: 'content_start', total: items.length })

      // Phase 3: import content items with URL rewriting applied from completed urlMap
      let imported = 0
      let skipped = 0

      // One prefetch instead of one findFirst() per item — a large WXR export can carry
      // thousands of items, which previously meant one D1 round trip per item just to
      // check for a slug collision before any write happened. Mirrors the same fix in
      // backup.ts's content-restore section (see applyBackup()).
      const existingSlugRows = items.length > 0
        ? await db.query.contentItems.findMany({
            where: and(eq(contentItems.siteId, siteId), inArray(contentItems.slug, items.map(i => i.slug))),
            columns: { slug: true },
          })
        : []
      const existingSlugs = new Set(existingSlugRows.map(i => i.slug))

      for (const item of items) {
        const typeId = item.postType === 'page' ? pageType.id : postType.id
        const itemId = ulid()

        if (existingSlugs.has(item.slug)) { skipped++; continue }

        let content = item.content
        for (const [remoteUrl, localUrl] of urlMap.entries()) {
          content = content.replaceAll(remoteUrl, localUrl)
        }

        const ogImage = item.featuredImageId ? (attachmentUrlByPostId.get(item.featuredImageId) ?? null) : null

        await db.insert(contentItems).values({
          id: itemId,
          siteId,
          typeId,
          authorId: userId,
          slug: item.slug,
          title: item.title || '(Untitled)',
          status: item.status as 'draft' | 'published',
          content: htmlToTipTap(content),
          excerpt: item.excerpt || null,
          ogImage,
          publishedAt: item.publishedAt,
        })
        // A WXR export shouldn't contain duplicate slugs, but recording it here keeps a
        // pathological one from inserting twice within the same run.
        existingSlugs.add(item.slug)

        const termIds = [...new Set([
          ...item.categories.map(n => catTermMap.get(n)),
          ...item.tags.map(n => tagTermMap.get(n)),
        ].filter((t): t is string => Boolean(t)))]
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

      // One summary row for the whole run rather than one per created row — this can touch
      // thousands of content items/media/taxonomy terms in a single invocation, and this is
      // one of the largest bulk-mutation surfaces in the codebase (admin-only, but with no
      // audit trail before this) — matches the pattern bulk-alt-text.post.ts already uses.
      await writeAuditLog(event, userId, {
        action: 'create',
        resource: 'content_item',
        resourceId: 'wordpress-import',
        after: { siteId, imported, skipped, categories: categories.size, tags: tags.size, mediaUploaded: mediaDone - mediaFailed, mediaFailed },
      })
    }
    catch (err) {
      await push({ type: 'error', message: errorMessage(err, 'Import failed') }).catch(() => {})
    }
    finally {
      await writer.close().catch(() => {})
    }
  })()

  return sendStream(event, readable)
})
