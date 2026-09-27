import { contentItems, contentTaxonomyTerms, contentTypes, sites, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from './db'
import { isItemIndexable, publicPathForItem, type SeoSettings } from './seo'

/**
 * The published, public, indexable content items of a site with their public URL paths —
 * the one list sitemap.xml, sitemap-images.xml, and llms.txt are all built from, so a
 * page can never be in one and wrongly missing from (or wrongly present in) another.
 * Excludes items marked noindex (per item, or by their content type's default) — listing
 * them made Search Console report "Submitted URL marked noindex".
 *
 * Never selects `content` (a full document per row) — see imagesForEntries() for the one
 * caller that needs it, which reads it in small pages.
 */
export interface IndexableEntry {
  id: string
  title: string
  slug: string
  path: string
  locale: string
  /** Id of the original this item translates (null for originals). */
  sourceItemId: string | null
  updatedAt: string
  publishedAt: string | null
  ogImage: string | null
  description: string | null
  typeSlug: string | null
  typeName: string | null
}

export async function getIndexableEntries(db: Db, siteId: string, seo: SeoSettings, limit: number): Promise<{ entries: IndexableEntry[]; defaultLocale: string; truncated: boolean }> {
  const [site, rows, types] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } }),
    db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')),
      columns: {
        id: true, title: true, slug: true, locale: true, sourceItemId: true, typeId: true, metaRobots: true,
        updatedAt: true, publishedAt: true, ogImage: true, seoDescription: true, excerpt: true,
      },
      orderBy: [desc(contentItems.publishedAt)],
      limit,
    }),
    db.query.contentTypes.findMany({ where: eq(contentTypes.siteId, siteId), columns: { id: true, slug: true, name: true } }),
  ])
  const defaultLocale = site?.locale || 'en'
  const typeById = new Map(types.map(t => [t.id, t]))
  const slugById = new Map(rows.map(r => [r.id, r.slug]))

  const entries = rows
    .map((r) => {
      const type = r.typeId ? typeById.get(r.typeId) : undefined
      return { r, typeSlug: type?.slug ?? null, typeName: type?.name ?? null }
    })
    .filter(({ r, typeSlug }) => isItemIndexable({ metaRobots: r.metaRobots, typeSlug }, seo))
    .map(({ r, typeSlug, typeName }) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      // A translation whose original isn't public stays reachable at its own slug.
      path: publicPathForItem({ slug: r.slug, locale: r.locale, sourceSlug: r.sourceItemId ? slugById.get(r.sourceItemId) ?? null : null }, defaultLocale),
      locale: r.locale || defaultLocale,
      sourceItemId: r.sourceItemId && slugById.has(r.sourceItemId) ? r.sourceItemId : null,
      updatedAt: r.updatedAt,
      publishedAt: r.publishedAt,
      ogImage: r.ogImage,
      description: r.seoDescription || r.excerpt,
      typeSlug,
      typeName,
    }))

  return { entries, defaultLocale, truncated: rows.length >= limit }
}

/** Translation groups (original + its translations) with more than one member, keyed by the original's id. */
export function alternateGroups(entries: IndexableEntry[]): Map<string, IndexableEntry[]> {
  const groups = new Map<string, IndexableEntry[]>()
  for (const e of entries) {
    const key = e.sourceItemId ?? e.id
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  for (const [key, group] of groups) if (group.length < 2) groups.delete(key)
  return groups
}

/** Taxonomy archive pages that actually list something, with the newest item's date. */
export async function getTaxonomyArchiveEntries(db: Db, siteId: string, limit: number): Promise<{ path: string; lastmod: string | null }[]> {
  const rows = await db
    .select({
      taxSlug: taxonomies.slug,
      termSlug: taxonomyTerms.slug,
      lastmod: sql<string | null>`max(${contentItems.updatedAt})`,
    })
    .from(taxonomyTerms)
    .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
    .innerJoin(contentTaxonomyTerms, eq(contentTaxonomyTerms.termId, taxonomyTerms.id))
    .innerJoin(contentItems, eq(contentItems.id, contentTaxonomyTerms.contentItemId))
    .where(and(
      eq(taxonomies.siteId, siteId),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
    ))
    .groupBy(taxonomies.slug, taxonomyTerms.slug)
    .limit(limit)
  return rows.map(r => ({ path: `/${r.taxSlug}/${r.termSlug}`, lastmod: r.lastmod }))
}

// ── Images ───────────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i

export function looksLikeImageUrl(value: string): boolean {
  if (!(value.startsWith('/') || /^https?:\/\//i.test(value))) return false
  if (value.startsWith('//')) return false
  return IMAGE_EXT.test(value) || value.includes('/_nuxflow/media/') || value.includes('imagedelivery.net/')
}

/** `src="…"` values from an HTML fragment (a Canvas text block's rich text). */
function htmlImageSources(html: string): string[] {
  const out: string[] = []
  let i = 0
  for (;;) {
    const tag = html.indexOf('<img', i)
    if (tag === -1) break
    const end = html.indexOf('>', tag)
    const chunk = html.slice(tag, end === -1 ? html.length : end)
    const srcAt = chunk.search(/\ssrc\s*=\s*["']/i)
    if (srcAt !== -1) {
      const quoteAt = chunk.indexOf('=', srcAt) + 1
      const rest = chunk.slice(quoteAt).trimStart()
      const quote = rest[0]!
      const close = rest.indexOf(quote, 1)
      if (close > 0) out.push(rest.slice(1, close))
    }
    i = end === -1 ? html.length : end + 1
  }
  return out
}

/** Every image URL referenced anywhere in a content document (TipTap, Canvas, or HTML). */
export function extractImageUrls(content: unknown, max = 1000): string[] {
  const found = new Set<string>()
  const visit = (v: unknown, depth: number) => {
    if (found.size >= max || depth > 40) return
    if (typeof v === 'string') {
      if (v.includes('<img')) {
        for (const src of htmlImageSources(v)) {
          if (looksLikeImageUrl(src)) found.add(src)
        }
      } else if (looksLikeImageUrl(v)) {
        found.add(v)
      }
      // Canvas stores gallery images as a JSON string.
      if (v.startsWith('[{') && v.includes('"url"')) {
        try {
          visit(JSON.parse(v), depth + 1)
        } catch { /* not JSON */ }
      }
    } else if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1)
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) visit(x, depth + 1)
    }
  }
  visit(content, 0)
  return [...found].slice(0, max)
}

/**
 * Image URLs per entry, reading `content` in small id-chunks (content rows can be large —
 * see CLAUDE.md's D1 isolate-memory notes) and capped at `maxPages` pages.
 */
export async function imagesForEntries(db: Db, siteId: string, entries: IndexableEntry[], maxPages: number): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  const scan = entries.slice(0, maxPages)
  const CHUNK = 25
  for (let i = 0; i < scan.length; i += CHUNK) {
    const ids = scan.slice(i, i + CHUNK).map(e => e.id)
    const rows = await db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId), inArray(contentItems.id, ids)),
      columns: { id: true, content: true, ogImage: true },
    })
    for (const row of rows) {
      const urls = extractImageUrls(row.content)
      if (row.ogImage && !row.ogImage.startsWith('data:') && !urls.includes(row.ogImage)) urls.unshift(row.ogImage)
      if (urls.length) result.set(row.id, urls.slice(0, 1000))
    }
  }
  return result
}
