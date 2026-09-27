/**
 * Pure helpers for public-page SEO: ISO dates, absolute URLs, FAQ extraction from Canvas
 * accordions, and schema.org JSON-LD. Kept free of Vue/Nuxt APIs so they're unit-testable
 * (tests/unit/app-seo.test.ts) and shared by ContentPage.vue, index.vue, and the layout.
 */

export interface PublicSiteSeo {
  title: string
  description: string
  ogImage: string
  twitterHandle: string
  socialProfiles: string[]
  verification: { google: string; bing: string; yandex: string; pinterest: string }
  noindex: boolean
  noindexTaxonomies: boolean
  markdownEnabled: boolean
}

export interface PublicSiteInfo {
  name?: string
  domain?: string
  locale?: string | null
  canonicalBase?: string
  logoUrl?: string | null
  locales?: string[]
  seo?: PublicSiteSeo
}

/**
 * A <link> entry for useHead(). Literal `rel` types per member (not a widened string) so
 * each one matches a member of unhead's Link union — see the note in layouts/default.vue.
 */
export type HeadLink =
  | { rel: 'canonical'; href: string }
  | { rel: 'alternate'; href: string; hreflang?: string; type?: string }

const SQLITE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/

/** Stored timestamps (SQLite `YYYY-MM-DD HH:MM:SS`, UTC, or ISO) → ISO 8601. */
export function toIsoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const m = SQLITE_DATETIME.exec(value)
  if (m) return `${m[1]}T${m[2]}Z`
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Makes a site-relative URL absolute against `origin`; absolute and data: URLs pass through (data: → undefined). */
export function absolutize(url: string | null | undefined, origin: string): string | undefined {
  if (!url || url.startsWith('data:')) return undefined
  if (url.startsWith('/') && !url.startsWith('//')) return `${origin.replace(/\/+$/, '')}${url}`
  return url
}

/** The public URL path for a locale variant (the site default locale has no prefix). */
export function localePath(locale: string, sourceSlug: string, defaultLocale: string): string {
  const slugPath = sourceSlug === 'home' ? '' : sourceSlug
  if (locale === defaultLocale) return `/${slugPath}`
  return slugPath ? `/${locale}/${slugPath}` : `/${locale}`
}

/** BCP 47 → Open Graph locale (`en` → `en`, `zh-CN` → `zh_CN`). */
export function ogLocale(locale: string | null | undefined): string | undefined {
  return locale ? locale.replace('-', '_') : undefined
}

interface CanvasBlockLike { type?: string; props?: Record<string, unknown>; children?: Record<string, CanvasBlockLike[]> }

/** Question/answer pairs from every Canvas accordion block on a page (nested ones included). */
export function extractFaqItems(content: unknown): { question: string; answer: string }[] {
  const blocks = (content as { type?: string; blocks?: CanvasBlockLike[] } | null)
  if (!blocks || blocks.type !== 'canvas' || !Array.isArray(blocks.blocks)) return []
  const out: { question: string; answer: string }[] = []
  const visit = (list: CanvasBlockLike[]) => {
    for (const b of list) {
      if (b.type === 'canvas-accordion') {
        let items: unknown = b.props?.itemsJson
        if (typeof items === 'string') {
          try {
            items = JSON.parse(items)
          } catch {
            items = []
          }
        }
        if (Array.isArray(items)) {
          for (const it of items as { question?: unknown; answer?: unknown }[]) {
            const q = typeof it.question === 'string' ? it.question.trim() : ''
            const a = typeof it.answer === 'string' ? it.answer.trim() : ''
            if (q && a) out.push({ question: q, answer: a })
          }
        }
      }
      for (const slot of Object.values(b.children ?? {})) visit(slot ?? [])
    }
  }
  visit(blocks.blocks)
  return out
}

export interface JsonLdPage {
  title: string
  description?: string
  url: string
  image?: string
  locale?: string
  publishedAt?: string | null
  updatedAt?: string | null
  author?: { name: string; image: string | null } | null
  type?: { slug: string; name: string } | null
  event?: { startAt: string; endAt?: string | null; allDay?: boolean | null; location?: string | null; url?: string | null } | null
  content?: unknown
  isHome?: boolean
}

export interface JsonLdSite {
  name: string
  base: string
  logoUrl?: string
}

type Json = Record<string, unknown>

/**
 * schema.org graph for a public page:
 * - `event` items → Event (dates, place or online location, organizer)
 * - `post` items → BlogPosting (with author/publisher/dates)
 * - everything else → WebPage
 * - plus FAQPage when the page has accordion Q&As, and a BreadcrumbList (Home › [Blog ›] page)
 */
export function buildPageJsonLd(page: JsonLdPage, site: JsonLdSite): Json[] {
  const out: Json[] = []
  const publisher: Json | undefined = site.name
    ? { '@type': 'Organization', name: site.name, url: site.base || undefined, ...(site.logoUrl ? { logo: { '@type': 'ImageObject', url: site.logoUrl } } : {}) }
    : undefined
  const author: Json | undefined = page.author
    ? { '@type': 'Person', name: page.author.name }
    : publisher
  const datePublished = toIsoDate(page.publishedAt)
  const dateModified = toIsoDate(page.updatedAt) ?? datePublished
  const typeSlug = page.type?.slug

  if (typeSlug === 'event' && page.event?.startAt) {
    const e = page.event
    const online = Boolean(e.url) && !e.location
    out.push({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: page.title,
      description: page.description || undefined,
      image: page.image,
      url: page.url,
      startDate: e.allDay ? e.startAt.slice(0, 10) : toIsoDate(e.startAt) ?? e.startAt,
      endDate: e.endAt ? (e.allDay ? e.endAt.slice(0, 10) : toIsoDate(e.endAt) ?? e.endAt) : undefined,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: online
        ? 'https://schema.org/OnlineEventAttendanceMode'
        : e.location && e.url ? 'https://schema.org/MixedEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
      location: online
        ? { '@type': 'VirtualLocation', url: e.url }
        : e.location ? { '@type': 'Place', name: e.location, address: e.location } : undefined,
      organizer: publisher,
    })
  } else if (typeSlug === 'post') {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: page.title,
      description: page.description || undefined,
      image: page.image,
      datePublished,
      dateModified,
      inLanguage: page.locale,
      url: page.url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': page.url },
      author,
      publisher,
    })
  } else {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description || undefined,
      url: page.url,
      inLanguage: page.locale,
      primaryImageOfPage: page.image ? { '@type': 'ImageObject', url: page.image } : undefined,
      datePublished,
      dateModified,
      isPartOf: site.base ? { '@type': 'WebSite', url: site.base, name: site.name } : undefined,
    })
  }

  const faq = extractFaqItems(page.content)
  if (faq.length > 0) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    })
  }

  if (!page.isHome && site.base) {
    const crumbs: Json[] = [{ '@type': 'ListItem', position: 1, name: site.name || 'Home', item: `${site.base}/` }]
    if (typeSlug === 'post') crumbs.push({ '@type': 'ListItem', position: 2, name: 'Blog', item: `${site.base}/blog` })
    crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: page.title, item: page.url })
    out.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs })
  }

  return out.map(stripUndefined)
}

/** Drops undefined values so the emitted JSON-LD has no `"key": null` noise. */
function stripUndefined(obj: Json): Json {
  return JSON.parse(JSON.stringify(obj)) as Json
}
