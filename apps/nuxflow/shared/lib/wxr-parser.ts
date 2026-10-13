// Parses a WordPress WXR (eXtended RSS) export into the shapes the WordPress import needs.
// Runs in the browser: the admin import page parses the file client-side and sends it to
// the server in small batches (see server/api/v1/import/wordpress/), so no request ever
// holds a whole export — a big one used to exceed the Worker's memory and D1's
// per-request query limit. Pure/dependency-free, so it's also directly unit testable —
// see tests/unit/wordpress-import.test.ts.
import { ulid } from 'ulid'
import { decodeHtmlEntities, stripHtmlToPlainText } from './html-text'

export interface WpItem {
  title: string
  slug: string
  status: string
  postType: string
  content: string
  excerpt: string
  publishedAt: string | null
  categories: string[]
  tags: string[]
  featuredImageId: string | null
}

export interface WpAttachment {
  title: string
  slug: string
  url: string
  postId: string | null
}

export interface WpCategory {
  name: string
  parentSlug: string | null
}

export interface ParsedWxr {
  items: WpItem[]
  attachments: WpAttachment[]
  categories: Map<string, WpCategory>
  tags: Map<string, string>
}

// wp:post_date_gmt is "YYYY-MM-DD HH:MM:SS" (space-separated, implicitly UTC) — every
// other timestamp in this app is a real ISO 8601 string (see `new Date().toISOString()`
// throughout), and content_items rows get compared/sorted as plain text, so a raw WP-style
// string would silently sort and parse inconsistently next to native content.
export function wpDateToIso(gmtDate: string | null): string | null {
  if (!gmtDate) return null
  const d = new Date(`${gmtDate.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// cdataOrTag is called several times per item during WXR parsing; caching the compiled
// regex per tag name avoids recompiling the same pattern on every call across every item.
const cdataOrTagRegexCache = new Map<string, { cdataRe: RegExp; plainRe: RegExp }>()

function cdataOrTag(block: string, tag: string): string | null {
  let pair = cdataOrTagRegexCache.get(tag)
  if (!pair) {
    pair = {
      cdataRe: new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`),
      plainRe: new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`),
    }
    cdataOrTagRegexCache.set(tag, pair)
  }
  const cm = block.match(pair.cdataRe)
  if (cm) return cm[1]!.trim()
  const pm = block.match(pair.plainRe)
  return pm ? pm[1]!.trim() : null
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ulid().toLowerCase()
}

export function parseWxr(xml: string): ParsedWxr {
  const items: WpItem[] = []
  const attachments: WpAttachment[] = []
  const categories = new Map<string, WpCategory>()
  const tags = new Map<string, string>()

  const catRegex = /<wp:category>([\s\S]*?)<\/wp:category>/g
  for (const m of xml.matchAll(catRegex)) {
    const block = m[1]!
    const nicename = cdataOrTag(block, 'wp:category_nicename')
    const name = cdataOrTag(block, 'wp:cat_name')
    if (!nicename || !name) continue
    const parentSlug = cdataOrTag(block, 'wp:category_parent')
    categories.set(nicename, { name: decodeHtmlEntities(name), parentSlug: parentSlug || null })
  }

  const tagRegex = /<wp:tag>[\s\S]*?<wp:tag_slug><!\[CDATA\[(.*?)\]\]><\/wp:tag_slug>[\s\S]*?<wp:tag_name><!\[CDATA\[(.*?)\]\]><\/wp:tag_name>[\s\S]*?<\/wp:tag>/g
  for (const m of xml.matchAll(tagRegex)) {
    tags.set(m[1]!, decodeHtmlEntities(m[2]!))
  }

  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  for (const itemMatch of xml.matchAll(itemRegex)) {
    const block = itemMatch[1]!
    const postType = cdataOrTag(block, 'wp:post_type') ?? 'post'

    if (postType === 'attachment') {
      const title = cdataOrTag(block, 'title') ?? ''
      const slug = cdataOrTag(block, 'wp:post_name') ?? slugify(title)
      const url = cdataOrTag(block, 'wp:attachment_url')
      const postId = cdataOrTag(block, 'wp:post_id')
      if (url) attachments.push({ title: decodeHtmlEntities(title), slug, url, postId })
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
    const termRegex = /<category domain="(category|post_tag)" nicename="([^"]+)">(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/category>/g
    for (const tm of block.matchAll(termRegex)) {
      const nicename = tm[2]!
      const name = decodeHtmlEntities((tm[3] ?? tm[4] ?? '').trim()) || nicename
      // A filtered WordPress export can reference terms on its items without listing them
      // in the channel-level <wp:category>/<wp:tag> blocks — register them from the
      // item's own <category> element so the assignment isn't silently dropped.
      if (tm[1] === 'category') {
        itemCats.push(nicename)
        if (!categories.has(nicename)) categories.set(nicename, { name, parentSlug: null })
      } else {
        itemTags.push(nicename)
        if (!tags.has(nicename)) tags.set(nicename, name)
      }
    }

    // WordPress stores the featured image as a <wp:postmeta> row whose key is
    // "_thumbnail_id" and whose value is the attachment's wp:post_id — resolved against
    // `attachments` by the caller once the whole file is parsed.
    const thumbMatch = /<wp:postmeta>\s*<wp:meta_key>_thumbnail_id<\/wp:meta_key>\s*<wp:meta_value>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/wp:meta_value>\s*<\/wp:postmeta>/.exec(block)
    const featuredImageId = thumbMatch ? (thumbMatch[1] ?? thumbMatch[2] ?? '').trim() || null : null

    items.push({
      title: decodeHtmlEntities(title),
      slug,
      status,
      postType,
      content,
      excerpt: stripHtmlToPlainText(excerpt),
      publishedAt: wpDateToIso(pubDate),
      categories: itemCats,
      tags: itemTags,
      featuredImageId,
    })
  }

  return { items, attachments, categories, tags }
}

// Swaps every URL in `html` that has an entry in `urlMap`, in one pass. Looping over the map
// with replaceAll() scanned each post once per imported image — posts × images full scans,
// tens of seconds of CPU for a few hundred posts with a large media library.
const URL_TOKEN_RE = /https?:\/\/[^\s"'<>]+/g
const TRAILING_PUNCTUATION_RE = /[.,;:!?)]+$/
export function replaceKnownUrls(html: string, urlMap: Map<string, string>): string {
  if (urlMap.size === 0) return html
  const lookup = (url: string): string | undefined => {
    const direct = urlMap.get(url)
    if (direct !== undefined) return direct
    // A resized variant (`a.jpg?w=300`, as Jetpack writes them) points at the same file —
    // the old replaceAll() loop rewrote these too, since it matched the URL as a prefix.
    const q = url.indexOf('?')
    const base = q === -1 ? undefined : urlMap.get(url.slice(0, q))
    return base === undefined ? undefined : base + url.slice(q)
  }
  return html.replace(URL_TOKEN_RE, (token) => {
    const found = lookup(token)
    if (found !== undefined) return found
    // A URL at the end of a sentence or inside parentheses picks up the punctuation.
    const trailing = TRAILING_PUNCTUATION_RE.exec(token)?.[0]
    if (!trailing) return token
    const trimmed = lookup(token.slice(0, -trailing.length))
    return trimmed === undefined ? token : trimmed + trailing
  })
}
