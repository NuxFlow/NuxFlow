import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { requireRole } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { TAXONOMY_SLUG_RE } from '../../../../utils/taxonomy'
import { ensureImportTaxonomy, getImportContentTypes, termIdsBySlug } from '../../../../utils/wordpress-import'
import { requireSiteId } from '../../../../utils/site-context'

const bodySchema = z.object({
  importId: z.string().min(1).max(64),
  links: z.array(z.object({
    slug: z.string().regex(TAXONOMY_SLUG_RE).max(100),
    parentSlug: z.string().regex(TAXONOMY_SLUG_RE).max(100),
  })).max(200),
})

// WordPress import, step 2: wires category parents once every category exists — a parent
// can arrive in a later batch than its child, so this can't be part of step 1. Links on a
// parent loop are dropped in the browser (categoryParentLinks); a link to itself is
// ignored here too. Like every parent-chain walk in this app, the readers are cycle-guarded
// (taxonomyTerms.parentId has no FK — see packages/db/src/schema/content.ts).
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = requireSiteId(event)
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  const { postTypeId } = await getImportContentTypes(db, siteId)
  const taxonomyId = await ensureImportTaxonomy(db, siteId, 'category', postTypeId)
  const ids = await termIdsBySlug(db, taxonomyId, body.links.flatMap(l => [l.slug, l.parentSlug]))

  let linked = 0
  for (const link of body.links) {
    const childId = ids.get(link.slug)
    const parentId = ids.get(link.parentSlug)
    if (!childId || !parentId || childId === parentId) continue
    await db.update(taxonomyTerms).set({ parentId }).where(eq(taxonomyTerms.id, childId))
    linked++
  }
  return { linked }
})
