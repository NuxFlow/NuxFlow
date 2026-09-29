import type { H3Event } from 'h3'
import { alias } from 'drizzle-orm/sqlite-core'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import {
  contentItems, contentTaxonomyTerms, contentTypes, sites, taxonomies, taxonomyContentTypes, taxonomyTerms,
} from '@nuxflow/db/schema'
import type { Db } from './db'
import { SUPPORTED_LOCALES } from './public-page'
import { getActiveLocales } from './locale-cache'
import { publicPathForItem } from './seo'
import { purgeContentCache, purgeEdgeCache } from './edge-cache'
import { badRequest, conflict, notFound, validationError } from './response'

// ── Slugs ────────────────────────────────────────────────────────────────────

/** Taxonomy/term slug rule, shared by every route that accepts one. */
export const TAXONOMY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * URL-safe slug from a display name. Accented Latin letters are folded to their base
 * letter (Café → cafe) so common names don't collapse to an empty slug; a name with no
 * Latin letters or digits at all still returns '' and the caller must ask for a slug.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

// First path segments the app itself owns. A taxonomy's slug is the first segment of its
// archive URLs (/{taxonomy}/{term}) and of its overview page (/{taxonomy}), so any of
// these would make its archives unreachable or shadow a real route.
const RESERVED_TAXONOMY_SLUGS = new Set([
  'admin', 'api', 'blog', 'search', 'account', 'login', 'register', 'forgot-password',
  'reset-password', 'setup', 'authorize', '_nuxflow', 'cdn-cgi', 'index', 'home',
  'feed', 'sitemap', 'robots', 'llms', 'events', 'tag-archive',
])

// Language-prefix shaped (`es`, `pt-br`, `zh-cn`) — the [taxonomySlug]/[termSlug] route
// treats a locale as a translated-page prefix, so a taxonomy named like one would be
// unreachable as soon as the site gained content in that language.
const LOCALE_SHAPED = /^[a-z]{2}(?:-[a-z]{2,4})?$/

/** Throws 409/422 when `slug` can't be used as a taxonomy slug on this site. */
export async function assertTaxonomySlugAvailable(db: Db, siteId: string, slug: string, excludeTaxonomyId?: string): Promise<void> {
  if (!TAXONOMY_SLUG_RE.test(slug)) validationError('Slugs may only contain lowercase letters, digits, and single dashes')
  if (RESERVED_TAXONOMY_SLUGS.has(slug)) validationError(`"${slug}" is reserved for a built-in page`)
  if (LOCALE_SHAPED.test(slug) || SUPPORTED_LOCALES.has(slug) || (await getActiveLocales(db, siteId)).has(slug)) {
    validationError(`"${slug}" looks like a language code, which is reserved for translated-page URLs`)
  }

  const [existingTax, existingItem] = await Promise.all([
    db.query.taxonomies.findFirst({
      where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, slug)),
      columns: { id: true },
    }),
    db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, slug)),
      columns: { id: true },
    }),
  ])
  if (existingTax && existingTax.id !== excludeTaxonomyId) conflict(`Taxonomy slug "${slug}" already exists`)
  // The taxonomy overview page lives at /{slug}, the same URL as a content item with that slug.
  if (existingItem) conflict(`"${slug}" is already used by a page or post — its URL would clash with this taxonomy's overview page`)
}

/**
 * The inverse of the content-item check above: a content slug equal to a taxonomy slug
 * would be shadowed by that taxonomy's overview page. Used by content create/update.
 */
export async function assertContentSlugNotTaxonomy(db: Db, siteId: string, slug: string): Promise<void> {
  const tax = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, slug)),
    columns: { id: true },
  })
  if (tax) conflict(`"${slug}" is the URL of a taxonomy's overview page — choose a different slug`)
}

// ── Paths ────────────────────────────────────────────────────────────────────

export function termArchivePath(taxonomySlug: string, termSlug: string): string {
  return `/${taxonomySlug}/${termSlug}`
}

export function termFeedPath(taxonomySlug: string, termSlug: string): string {
  return `/feed.xml?taxonomy=${encodeURIComponent(taxonomySlug)}&term=${encodeURIComponent(termSlug)}`
}

export interface TermRef { taxonomySlug: string; termSlug: string }

// ── Hierarchy ────────────────────────────────────────────────────────────────

// A taxonomy's whole term tree is small (hundreds at most — it's hand-curated), so the
// hierarchy helpers load it in one query and walk it in memory rather than issuing one
// query per level. parentId has no DB-level FK (see the schema comment), so every walk
// is cycle-guarded even though writes reject cycles.
async function loadParentMap(db: Db, taxonomyId: string): Promise<Map<string, string | null>> {
  const rows = await db.select({ id: taxonomyTerms.id, parentId: taxonomyTerms.parentId })
    .from(taxonomyTerms)
    .where(eq(taxonomyTerms.taxonomyId, taxonomyId))
  return new Map(rows.map(r => [r.id, r.parentId]))
}

/** `termId` plus every term nested under it (any depth). */
export async function getTermWithDescendantIds(db: Db, taxonomyId: string, termId: string): Promise<string[]> {
  const parentOf = await loadParentMap(db, taxonomyId)
  const childrenOf = new Map<string, string[]>()
  for (const [id, parentId] of parentOf) {
    if (!parentId) continue
    const list = childrenOf.get(parentId)
    if (list) list.push(id)
    else childrenOf.set(parentId, [id])
  }
  const out = new Set<string>([termId])
  const queue = [termId]
  while (queue.length) {
    for (const child of childrenOf.get(queue.shift()!) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        queue.push(child)
      }
    }
  }
  return [...out]
}

/**
 * Validates a (new) parent for a term: the taxonomy must be hierarchical, the parent must
 * be a term of the same taxonomy, and it must not be the term itself or one of its
 * descendants (which would create a cycle).
 */
export async function assertValidTermParent(
  db: Db,
  taxonomy: { id: string; isHierarchical: boolean },
  termId: string | null,
  parentId: string,
): Promise<void> {
  if (!taxonomy.isHierarchical) validationError('Only terms in a hierarchical taxonomy can have a parent')
  if (termId && parentId === termId) badRequest('A term cannot be its own parent')
  const parentOf = await loadParentMap(db, taxonomy.id)
  if (!parentOf.has(parentId)) notFound('Parent term not found')
  if (!termId) return
  const seen = new Set<string>()
  let cursor: string | null | undefined = parentId
  while (cursor && !seen.has(cursor)) {
    if (cursor === termId) badRequest('A term cannot be nested under one of its own sub-terms')
    seen.add(cursor)
    cursor = parentOf.get(cursor)
  }
}

/** A term's ancestors, root first (for breadcrumbs). */
export async function getTermAncestors(db: Db, taxonomyId: string, termId: string): Promise<{ id: string; slug: string; name: string }[]> {
  const rows = await db.select({ id: taxonomyTerms.id, slug: taxonomyTerms.slug, name: taxonomyTerms.name, parentId: taxonomyTerms.parentId })
    .from(taxonomyTerms)
    .where(eq(taxonomyTerms.taxonomyId, taxonomyId))
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: { id: string; slug: string; name: string }[] = []
  const seen = new Set<string>([termId])
  let cursor = byId.get(termId)?.parentId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const row = byId.get(cursor)
    if (!row) break
    out.unshift({ id: row.id, slug: row.slug, name: row.name })
    cursor = row.parentId
  }
  return out
}

/**
 * Archive refs for the given terms *and all their ancestors* — a parent's archive lists
 * its sub-terms' content too, so tagging/untagging with a child changes the parent's
 * archive and it must be purged along with it.
 */
export async function getTermRefsWithAncestors(db: Db, termIds: string[]): Promise<TermRef[]> {
  if (termIds.length === 0) return []
  const direct = await db.select({ taxonomyId: taxonomyTerms.taxonomyId })
    .from(taxonomyTerms)
    .where(inArray(taxonomyTerms.id, termIds))
  const taxonomyIds = [...new Set(direct.map(d => d.taxonomyId))]
  if (taxonomyIds.length === 0) return []
  const rows = await db.select({
    id: taxonomyTerms.id, slug: taxonomyTerms.slug, parentId: taxonomyTerms.parentId, taxonomySlug: taxonomies.slug,
  })
    .from(taxonomyTerms)
    .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
    .where(inArray(taxonomyTerms.taxonomyId, taxonomyIds))
  const byId = new Map(rows.map(r => [r.id, r]))
  const refs = new Map<string, TermRef>()
  for (const id of termIds) {
    const seen = new Set<string>()
    let cursor: string | null | undefined = id
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const row = byId.get(cursor)
      if (!row) break
      refs.set(row.id, { taxonomySlug: row.taxonomySlug, termSlug: row.slug })
      cursor = row.parentId
    }
  }
  return [...refs.values()]
}

// ── Content ↔ term assignments ───────────────────────────────────────────────

/**
 * De-duplicates `termIds` and checks every one belongs to a taxonomy owned by this site
 * (otherwise a caller could link content to another tenant's term by its ULID). Returns
 * the unique ids.
 */
export async function validateSiteTermIds(db: Db, siteId: string, termIds: string[]): Promise<string[]> {
  const unique = [...new Set(termIds)]
  if (unique.length === 0) return unique
  const valid = await db.select({ id: taxonomyTerms.id })
    .from(taxonomyTerms)
    .innerJoin(taxonomies, eq(taxonomyTerms.taxonomyId, taxonomies.id))
    .where(and(inArray(taxonomyTerms.id, unique), eq(taxonomies.siteId, siteId)))
  if (valid.length !== unique.length) validationError('One or more termIds do not belong to this site')
  return unique
}

/** The current term ids of one item. */
export async function getContentTermIds(db: Db, itemId: string): Promise<string[]> {
  const rows = await db.select({ termId: contentTaxonomyTerms.termId })
    .from(contentTaxonomyTerms)
    .where(eq(contentTaxonomyTerms.contentItemId, itemId))
  return rows.map(r => r.termId)
}

/** Batch statements replacing one item's whole term set (delete, then insert). */
export function replaceContentTermsStatements(db: Db, itemId: string, termIds: string[]): BatchItem<'sqlite'>[] {
  const writes: BatchItem<'sqlite'>[] = [db.delete(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, itemId))]
  if (termIds.length > 0) {
    writes.push(db.insert(contentTaxonomyTerms).values(termIds.map(termId => ({ contentItemId: itemId, termId }))))
  }
  return writes
}

/** Taxonomies that apply to a content type: explicitly linked ones plus unscoped ones. */
export async function getTaxonomyContentTypeSlugs(db: Db, taxonomyIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(taxonomyIds.map(id => [id, []]))
  if (taxonomyIds.length === 0) return out
  const rows = await db.select({ taxonomyId: taxonomyContentTypes.taxonomyId, slug: contentTypes.slug })
    .from(taxonomyContentTypes)
    .innerJoin(contentTypes, eq(contentTypes.id, taxonomyContentTypes.contentTypeId))
    .where(inArray(taxonomyContentTypes.taxonomyId, taxonomyIds))
  for (const r of rows) out.get(r.taxonomyId)?.push(r.slug)
  return out
}

/** Replaces a taxonomy's content-type scope. Unknown slugs are a 422. */
export async function setTaxonomyContentTypesStatements(
  db: Db, siteId: string, taxonomyId: string, typeSlugs: string[],
): Promise<BatchItem<'sqlite'>[]> {
  const unique = [...new Set(typeSlugs)]
  const types = unique.length
    ? await db.select({ id: contentTypes.id }).from(contentTypes)
        .where(and(eq(contentTypes.siteId, siteId), inArray(contentTypes.slug, unique)))
    : []
  if (types.length !== unique.length) validationError('One or more content types do not exist on this site')
  const writes: BatchItem<'sqlite'>[] = [db.delete(taxonomyContentTypes).where(eq(taxonomyContentTypes.taxonomyId, taxonomyId))]
  if (types.length) writes.push(db.insert(taxonomyContentTypes).values(types.map(t => ({ taxonomyId, contentTypeId: t.id }))))
  return writes
}

// ── Public listings ──────────────────────────────────────────────────────────

const sourceItems = alias(contentItems, 'source_items')

/** Published, public items tagged with any of `termIds` (distinct), newest first, with their public path. */
export async function getPublicItemsForTerms(
  db: Db,
  siteId: string,
  termIds: string[],
  opts: { limit: number; offset: number },
  extra?: SQL,
): Promise<{ items: PublicListItem[]; total: number }> {
  if (termIds.length === 0) return { items: [], total: 0 }
  const tagged = db.selectDistinct({ id: contentTaxonomyTerms.contentItemId })
    .from(contentTaxonomyTerms)
    .where(inArray(contentTaxonomyTerms.termId, termIds))
  return listPublicItems(db, siteId, and(inArray(contentItems.id, tagged), extra), opts)
}

export interface PublicListItem {
  id: string
  title: string
  slug: string
  path: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
  typeSlug: string | null
}

/**
 * The shared "published, public items, newest first, with the right public URL" listing
 * behind taxonomy archives and the public posts API. `extra` narrows it further.
 */
export async function listPublicItems(
  db: Db,
  siteId: string,
  extra: SQL | undefined,
  opts: { limit: number; offset: number },
): Promise<{ items: PublicListItem[]; total: number }> {
  const where = and(
    eq(contentItems.siteId, siteId),
    eq(contentItems.status, 'published'),
    eq(contentItems.visibility, 'public'),
    extra,
  )
  const [site, [countRow], rows] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } }),
    db.select({ total: sql<number>`count(*)` }).from(contentItems).where(where),
    db.select({
      id: contentItems.id,
      title: contentItems.title,
      slug: contentItems.slug,
      locale: contentItems.locale,
      sourceSlug: sourceItems.slug,
      excerpt: contentItems.excerpt,
      ogImage: contentItems.ogImage,
      publishedAt: contentItems.publishedAt,
      typeSlug: contentTypes.slug,
    })
      .from(contentItems)
      .leftJoin(sourceItems, eq(sourceItems.id, contentItems.sourceItemId))
      .leftJoin(contentTypes, eq(contentTypes.id, contentItems.typeId))
      .where(where)
      .orderBy(sql`${contentItems.publishedAt} DESC`, asc(contentItems.id))
      .limit(opts.limit)
      .offset(opts.offset),
  ])
  const defaultLocale = site?.locale || 'en'
  return {
    total: Number(countRow?.total ?? 0),
    items: rows.map(({ locale, sourceSlug, ...r }) => ({
      ...r,
      path: publicPathForItem({ slug: r.slug, locale, sourceSlug }, defaultLocale),
    })),
  }
}

/**
 * Resolves a public `?taxonomy=&term=` filter to the term plus its descendants' ids.
 * Returns null when the taxonomy or term doesn't exist on this site.
 */
export async function resolvePublicTermFilter(db: Db, siteId: string, taxonomySlug: string, termSlug: string) {
  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, taxonomySlug)),
  })
  if (!taxonomy) return null
  const term = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.taxonomyId, taxonomy.id), eq(taxonomyTerms.slug, termSlug)),
  })
  if (!term) return null
  const termIds = taxonomy.isHierarchical ? await getTermWithDescendantIds(db, taxonomy.id, term.id) : [term.id]
  return { taxonomy, term, termIds }
}

/**
 * Terms of one taxonomy with how many published, public items each lists — `count` is
 * the term's own, `total` includes sub-terms (distinct items), which is what its
 * archive actually shows.
 */
export async function getPublicTermCounts(db: Db, siteId: string, taxonomyId: string) {
  const terms = await db.select({
    id: taxonomyTerms.id, slug: taxonomyTerms.slug, name: taxonomyTerms.name,
    description: taxonomyTerms.description, parentId: taxonomyTerms.parentId, sortOrder: taxonomyTerms.sortOrder,
  })
    .from(taxonomyTerms)
    .where(eq(taxonomyTerms.taxonomyId, taxonomyId))
    .orderBy(asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name))

  const assignments = await db.select({ termId: contentTaxonomyTerms.termId, itemId: contentTaxonomyTerms.contentItemId })
    .from(contentTaxonomyTerms)
    .innerJoin(taxonomyTerms, eq(taxonomyTerms.id, contentTaxonomyTerms.termId))
    .innerJoin(contentItems, eq(contentItems.id, contentTaxonomyTerms.contentItemId))
    .where(and(
      eq(taxonomyTerms.taxonomyId, taxonomyId),
      eq(contentItems.siteId, siteId),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
    ))

  const itemsByTerm = new Map<string, Set<string>>()
  for (const a of assignments) {
    const set = itemsByTerm.get(a.termId)
    if (set) set.add(a.itemId)
    else itemsByTerm.set(a.termId, new Set([a.itemId]))
  }
  const parentOf = new Map(terms.map(t => [t.id, t.parentId]))
  const totals = new Map<string, Set<string>>()
  for (const [termId, items] of itemsByTerm) {
    const seen = new Set<string>()
    let cursor: string | null | undefined = termId
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const set = totals.get(cursor) ?? new Set<string>()
      for (const i of items) set.add(i)
      totals.set(cursor, set)
      cursor = parentOf.get(cursor)
    }
  }
  const slugById = new Map(terms.map(t => [t.id, t.slug]))
  return terms.map(t => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    parentSlug: t.parentId ? slugById.get(t.parentId) ?? null : null,
    count: itemsByTerm.get(t.id)?.size ?? 0,
    total: totals.get(t.id)?.size ?? 0,
  }))
}

/** Public terms of one item, grouped for display (categories vs tags). */
export async function getPublicItemTerms(db: Db, itemId: string) {
  return db.select({
    taxonomySlug: taxonomies.slug,
    taxonomyName: taxonomies.name,
    isHierarchical: taxonomies.isHierarchical,
    termSlug: taxonomyTerms.slug,
    termName: taxonomyTerms.name,
  })
    .from(contentTaxonomyTerms)
    .innerJoin(taxonomyTerms, eq(taxonomyTerms.id, contentTaxonomyTerms.termId))
    .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
    .where(eq(contentTaxonomyTerms.contentItemId, itemId))
    .orderBy(asc(taxonomies.slug), asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name))
}

// ── Cache ────────────────────────────────────────────────────────────────────

/**
 * Purges a taxonomy's overview page and the site payload (which lists taxonomies), plus —
 * when `itemsOfTermIds` is given — every page tagged with those terms (a term rename or
 * delete changes the term chips those pages render) and their archives.
 */
export async function purgeTaxonomyCache(
  event: H3Event,
  db: Db,
  opts: { taxonomySlugs: string[]; terms?: TermRef[]; itemsOfTermIds?: string[] },
): Promise<void> {
  const paths = ['/api/public/site', '/sitemap.xml']
  for (const slug of new Set(opts.taxonomySlugs)) paths.push(`/${slug}`, `/api/public/taxonomy/${slug}`)
  await purgeEdgeCache(event, paths)

  let slugs: string[] = []
  let extraPaths: string[] = []
  if (opts.itemsOfTermIds?.length) {
    const rows = await db.select({
      slug: contentItems.slug, locale: contentItems.locale, sourceSlug: sourceItems.slug, siteLocale: sites.locale,
    })
      .from(contentTaxonomyTerms)
      .innerJoin(contentItems, eq(contentItems.id, contentTaxonomyTerms.contentItemId))
      .innerJoin(sites, eq(sites.id, contentItems.siteId))
      .leftJoin(sourceItems, eq(sourceItems.id, contentItems.sourceItemId))
      .where(and(inArray(contentTaxonomyTerms.termId, opts.itemsOfTermIds), eq(contentItems.status, 'published')))
      .limit(500)
    slugs = rows.map(r => r.slug)
    extraPaths = rows.map(r => publicPathForItem({ slug: r.slug, locale: r.locale, sourceSlug: r.sourceSlug }, r.siteLocale || 'en'))
  }
  if (opts.terms?.length || slugs.length) {
    await purgeContentCache(event, { slugs, extraPaths, taxonomyTerms: opts.terms ?? [] })
  }
}

