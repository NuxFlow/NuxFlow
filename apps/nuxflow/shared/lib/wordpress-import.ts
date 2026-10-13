// Planning helpers for the WordPress import, run in the browser on the parsed export (see
// wxr-parser.ts) before it's sent to the server in batches. Pure, so they're unit tested
// directly (tests/unit/wordpress-import.test.ts).
import { slugify } from './slug'
import type { ParsedWxr, WpItem } from './wxr-parser'

/**
 * WordPress nicenames aren't valid NuxFlow slugs as-is: non-Latin names are stored
 * percent-encoded (%e6%97%a5…) and older exports can carry uppercase. Maps each nicename
 * to a clean slug, unique within the list, keyed by the original so item assignments and
 * parent links still resolve. Worked out once for the whole file — the server receives
 * terms in batches, and a per-batch map could give two different terms the same slug.
 */
export function buildTermSlugMap(entries: [nicename: string, name: string][]): Map<string, string> {
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

/**
 * Category parent links as `{ slug, parentSlug }`. WXR's wp:category_parent references the
 * parent by nicename. Only a category that is itself on a parent loop loses its parent; one
 * merely nested under a loop keeps it (valid once the loop's own links are skipped).
 */
export function categoryParentLinks(
  categories: ParsedWxr['categories'],
  slugByNicename: Map<string, string>,
): { slug: string; parentSlug: string }[] {
  const links: { slug: string; parentSlug: string }[] = []
  for (const [nicename, cat] of categories) {
    if (!cat.parentSlug) continue
    const slug = slugByNicename.get(nicename)
    const parentSlug = slugByNicename.get(cat.parentSlug)
    if (!slug || !parentSlug) continue
    let cyclic = false
    const seen = new Set<string>()
    for (let cursor: string | null | undefined = cat.parentSlug; cursor && !seen.has(cursor); cursor = categories.get(cursor)?.parentSlug) {
      if (cursor === nicename) {
        cyclic = true
        break
      }
      seen.add(cursor)
    }
    if (!cyclic) links.push({ slug, parentSlug })
  }
  return links
}

/** Every image to import: attachments plus inline `<img src>` URLs, de-duplicated. */
export function collectImageUrls(parsed: Pick<ParsedWxr, 'attachments' | 'items'>): string[] {
  const urls = new Set<string>()
  for (const att of parsed.attachments) {
    if (/^https?:\/\//i.test(att.url)) urls.add(att.url)
  }
  for (const item of parsed.items) {
    for (const m of item.content.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/g)) urls.add(m[1]!)
  }
  return [...urls]
}

/**
 * Splits items into request-sized batches: at most `maxItems` per batch, and a new batch
 * once the items' text passes `maxChars` (a long post can be a lot of HTML). A single item
 * bigger than `maxChars` still gets a batch of its own.
 */
export function batchItems<T extends Pick<WpItem, 'content'>>(items: T[], maxItems: number, maxChars: number): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let chars = 0
  for (const item of items) {
    const size = item.content.length
    if (current.length > 0 && (current.length >= maxItems || chars + size > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** `list` in consecutive chunks of at most `size`. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
