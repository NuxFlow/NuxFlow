/**
 * Taxonomy-specific restore behaviour (restore-taxonomies.ts / restore-content.ts):
 *  - content "taxonomy/term" paths resolve to the restored terms, de-duplicated
 *  - cyclic parentSlug links in a (user-editable) backup are dropped
 *  - term SEO/order fields and taxonomy content-type scoping round-trip
 *  - an overwrite restore without the taxonomies section keeps content's existing terms
 *  - duplicate termSlugs on an item don't abort the restore
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite, seedContentType, seedContentItem } from '../helpers/seed'
import { contentTaxonomyTerms, taxonomies, taxonomyContentTypes, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../../server/utils/backup-types'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { restoreTaxonomies, restoreTaxonomyContentTypes } = await import('../../server/utils/backup-restore/restore-taxonomies')
const { restoreContent } = await import('../../server/utils/backup-restore/restore-content')

const SITE = 'site-taxrestore-01'
let postTypeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'taxrestore.localhost' })
  postTypeId = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
})

afterAll(teardownTestDb)

function freshResult(): RestoreResult {
  const zero = { created: 0, updated: 0, skipped: 0 }
  return {
    site: { updated: false }, content: { ...zero }, taxonomies: { created: 0 }, terms: { created: 0 },
    menus: { created: 0 }, forms: { created: 0 }, settings: { updated: 0 },
    themes: { ...zero }, plugins: { ...zero, rejected: 0 }, users: { ...zero }, membershipTiers: { ...zero }, redirects: { ...zero },
  }
}

async function restore(backup: Partial<NuxFlowBackup>, opts: RestoreOptions) {
  const db = getCurrentTestDb()
  const result = freshResult()
  const map = await restoreTaxonomies(db, SITE, backup as NuxFlowBackup, opts, result)
  await restoreContent(db, SITE, backup as NuxFlowBackup, opts, result, map)
  await restoreTaxonomyContentTypes(db, SITE, backup as NuxFlowBackup, opts)
  return result
}

async function itemTermSlugs(slug: string) {
  const db = getCurrentTestDb()
  const item = await db.query.contentItems.findFirst({ where: (t, { and, eq }) => and(eq(t.siteId, SITE), eq(t.slug, slug)) })
  const rows = await db.select({ slug: taxonomyTerms.slug })
    .from(contentTaxonomyTerms)
    .innerJoin(taxonomyTerms, eq(taxonomyTerms.id, contentTaxonomyTerms.termId))
    .where(eq(contentTaxonomyTerms.contentItemId, item!.id))
  return rows.map(r => r.slug).sort()
}

const baseItem = {
  typeSlug: 'post', title: 'T', status: 'published', visibility: 'public', content: null, excerpt: null,
  seoTitle: null, seoDescription: null, ogImage: null, publishedAt: null, settings: null, locale: 'en', sourceItemSlug: null,
}

describe('taxonomy restore', () => {
  it('resolves content term paths onto the restored terms, de-duplicated', async () => {
    await restore({
      taxonomies: [{ slug: 'tag', name: 'Tags', isHierarchical: false, terms: [{ slug: 'nuxt', name: 'Nuxt', description: null, parentSlug: null }] }],
      content: [{ ...baseItem, slug: 'legacy-post', termSlugs: ['tag/nuxt', 'tag/nuxt'] }],
    }, { what: ['taxonomies', 'content'], conflictMode: 'skip' })

    const db = getCurrentTestDb()
    const tax = await db.query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, SITE), eq(taxonomies.slug, 'tag')) })
    expect(tax).toBeDefined()
    expect(await itemTermSlugs('legacy-post')).toEqual(['nuxt'])
  })

  it('drops cyclic parent links and restores term SEO/order fields and content-type scope', async () => {
    await restore({
      taxonomies: [{
        slug: 'loop', name: 'Loop', isHierarchical: true, contentTypes: ['post'],
        terms: [
          { slug: 'a', name: 'A', description: null, parentSlug: 'b', sortOrder: 2, seoTitle: 'A title', ogImage: '/a.png' },
          { slug: 'b', name: 'B', description: null, parentSlug: 'a' },
          { slug: 'c', name: 'C', description: null, parentSlug: 'b' },
        ],
      }],
    }, { what: ['taxonomies'], conflictMode: 'skip' })

    const db = getCurrentTestDb()
    const tax = await db.query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, SITE), eq(taxonomies.slug, 'loop')) })
    const terms = await db.query.taxonomyTerms.findMany({ where: eq(taxonomyTerms.taxonomyId, tax!.id) })
    const bySlug = Object.fromEntries(terms.map(t => [t.slug, t]))
    expect(bySlug.a!.parentId).toBeNull()
    expect(bySlug.b!.parentId).toBeNull()
    expect(bySlug.c!.parentId).toBe(bySlug.b!.id)
    expect(bySlug.a).toMatchObject({ sortOrder: 2, seoTitle: 'A title', ogImage: '/a.png' })

    const scope = await db.select().from(taxonomyContentTypes).where(eq(taxonomyContentTypes.taxonomyId, tax!.id))
    expect(scope.map(s => s.contentTypeId)).toEqual([postTypeId])
  })

  it('an overwrite restore without taxonomies keeps content\'s resolvable terms instead of stripping them', async () => {
    const db = getCurrentTestDb()
    const taxId = ulid()
    const termId = ulid()
    await db.insert(taxonomies).values({ id: taxId, siteId: SITE, slug: 'topics', name: 'Topics' })
    await db.insert(taxonomyTerms).values({ id: termId, taxonomyId: taxId, slug: 'vue', name: 'Vue' })
    const itemId = await seedContentItem(db, SITE, postTypeId, { slug: 'keep-terms' })
    await db.insert(contentTaxonomyTerms).values({ contentItemId: itemId, termId })

    await restore({
      content: [{ ...baseItem, slug: 'keep-terms', title: 'Updated', termSlugs: ['topics/vue'] }],
    }, { what: ['content'], conflictMode: 'overwrite' })

    expect(await itemTermSlugs('keep-terms')).toEqual(['vue'])
  })
})
