import { z } from 'zod'
import { ulid } from 'ulid'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { requireRole } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { writeAuditLog } from '../../../../utils/audit'
import { TAXONOMY_SLUG_RE } from '../../../../utils/taxonomy'
import { chunked, ensureImportTaxonomy, getImportContentTypes, termIdsBySlug } from '../../../../utils/wordpress-import'

const bodySchema = z.object({
  importId: z.string().min(1).max(64),
  taxonomy: z.enum(['category', 'tag']),
  // Slugs are worked out in the browser for the whole file (buildTermSlugMap) so batches
  // can't collide; validated here all the same.
  terms: z.array(z.object({
    slug: z.string().regex(TAXONOMY_SLUG_RE).max(100),
    name: z.string().min(1).max(200),
  })).max(200),
})

// Rows per insert statement — each row binds a handful of parameters, and D1 allows 100
// per statement.
const INSERT_CHUNK = 8

// WordPress import, step 1 (see server/utils/wordpress-import.ts): creates a batch of
// categories or tags, reusing any the site already has with the same slug, and returns
// slug → term id for all of them. Called for both taxonomies even when the file has none,
// so both exist — and so a site missing its page/post types fails here, before any media
// is uploaded.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  const { postTypeId } = await getImportContentTypes(db, siteId)
  const taxonomyId = await ensureImportTaxonomy(db, siteId, body.taxonomy, postTypeId)

  const ids = await termIdsBySlug(db, taxonomyId, body.terms.map(t => t.slug))
  const toCreate = body.terms.filter(t => !ids.has(t.slug))
  const seen = new Set<string>()
  const rows = toCreate
    .filter(t => !seen.has(t.slug) && seen.add(t.slug))
    .map(t => ({ id: ulid(), taxonomyId, slug: t.slug, name: t.name }))
  for (const part of chunked(rows, INSERT_CHUNK)) {
    await db.insert(taxonomyTerms).values(part)
  }
  for (const row of rows) ids.set(row.slug, row.id)

  if (rows.length > 0) {
    await writeAuditLog(event, userId, {
      action: 'create',
      resource: 'taxonomy_term',
      resourceId: 'wordpress-import',
      after: { importId: body.importId, taxonomy: body.taxonomy, created: rows.length },
    })
  }

  return { ids: Object.fromEntries(ids), created: rows.length }
})
