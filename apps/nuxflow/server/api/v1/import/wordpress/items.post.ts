import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, contentTaxonomyTerms, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { requireRole } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { assertWithinPlan } from '../../../../utils/hosting-plans'
import { writeAuditLog } from '../../../../utils/audit'
import { htmlToTipTap } from '../../../../utils/html-to-tiptap'
import { getImportContentTypes, IN_LIST_CHUNK } from '../../../../utils/wordpress-import'
import { chunk } from '../../../../../shared/lib/array'

// Content is already rewritten in the browser to point at the imported media, and
// termIds come from the terms step's responses.
const bodySchema = z.object({
  importId: z.string().min(1).max(64),
  items: z.array(z.object({
    slug: z.string().min(1).max(500),
    title: z.string().max(500),
    status: z.enum(['published', 'draft']),
    postType: z.enum(['post', 'page']),
    content: z.string().max(5_000_000),
    excerpt: z.string().max(20_000),
    publishedAt: z.string().max(40).nullable(),
    ogImage: z.string().max(2048).nullable(),
    termIds: z.array(z.string().max(64)).max(500),
  })).min(1).max(25),
})

// WordPress import, step 4: creates a batch of posts and pages. An item whose slug the site
// already uses is skipped — which also makes a retried batch safe.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  const { pageTypeId, postTypeId } = await getImportContentTypes(db, siteId)

  const existingSlugs = new Set((await db.query.contentItems.findMany({
    where: and(eq(contentItems.siteId, siteId), inArray(contentItems.slug, [...new Set(body.items.map(i => i.slug))])),
    columns: { slug: true },
  })).map(r => r.slug))

  // Only this site's terms may be attached — the ids come from the browser.
  const wantedTermIds = [...new Set(body.items.flatMap(i => i.termIds))]
  const validTermIds = new Set<string>()
  for (const part of chunk(wantedTermIds, IN_LIST_CHUNK)) {
    const rows = await db.select({ id: taxonomyTerms.id })
      .from(taxonomyTerms)
      .innerJoin(taxonomies, eq(taxonomyTerms.taxonomyId, taxonomies.id))
      .where(and(inArray(taxonomyTerms.id, part), eq(taxonomies.siteId, siteId)))
    for (const r of rows) validTermIds.add(r.id)
  }

  let imported = 0
  let skipped = 0
  for (const item of body.items) {
    if (existingSlugs.has(item.slug)) {
      skipped++
      continue
    }
    // Items already imported in this batch stay; the import page shows the message and stops.
    await assertWithinPlan(event, 'content')
    const itemId = ulid()
    await db.insert(contentItems).values({
      id: itemId,
      siteId,
      typeId: item.postType === 'page' ? pageTypeId : postTypeId,
      authorId: userId,
      slug: item.slug,
      title: item.title || '(Untitled)',
      status: item.status,
      content: htmlToTipTap(item.content),
      excerpt: item.excerpt || null,
      ogImage: item.ogImage,
      publishedAt: item.publishedAt,
    })
    // A WXR export shouldn't contain duplicate slugs, but recording it here keeps a
    // pathological one from inserting twice within the same batch.
    existingSlugs.add(item.slug)

    const termIds = [...new Set(item.termIds)].filter(id => validTermIds.has(id))
    if (termIds.length > 0) {
      await db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: itemId, termId })))
    }
    imported++
  }

  if (imported > 0) {
    await writeAuditLog(event, userId, {
      action: 'create',
      resource: 'content_item',
      resourceId: 'wordpress-import',
      after: { importId: body.importId, imported, skipped },
    })
  }

  return { imported, skipped }
})
