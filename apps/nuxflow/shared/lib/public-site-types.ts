// What GET /api/public/site sends: the site's public settings, read by the layout, the
// header, SEO tags, forms (Turnstile) and more. Built by buildPayload() in
// server/api/public/site.get.ts, which is declared to return this, so the two can't drift.
// Edge-cached for every visitor, so nothing private ever belongs here.
import type { BusinessInfo } from '@nuxflow/canvas/business'
import type { PublicSignupSettings } from './signup-prompt'

/** Site-wide SEO defaults (Admin → SEO). */
export interface PublicSiteSeo {
  title: string
  description: string
  /** An absolute URL, or '' when none is set. */
  ogImage: string
  twitterHandle: string
  socialProfiles: string[]
  verification: { google: string; bing: string; yandex: string; pinterest: string }
  noindex: boolean
  noindexTaxonomies: boolean
  markdownEnabled: boolean
}

export interface PublicSite {
  name: string
  domain: string
  locale: string
  timezone: string
  /** The address the site is reached at, for absolute links and canonicals. */
  canonicalBase: string
  showHeader: boolean
  showColorToggle: boolean
  showSearch: boolean
  showStickyHeader: boolean
  /** Settings → Appearance → Posts: "5 min read" on posts, "On this page" on long pages. */
  showReadingTime: boolean
  showToc: boolean
  logoSize: string
  logoUrl: string | null
  faviconUrl: string | null
  /** Empty when Turnstile isn't set up: forms then skip the challenge. */
  turnstileSiteKey: string | null
  /** A dynamic plugin's block that replaces the built-in header or footer (Admin → Themes). */
  headerBlockId: string | null
  footerBlockId: string | null
  imageTransformsEnabled: boolean
  /** Some active plugin has client code, so dynamic-plugins.client.ts loads them. */
  hasPlugins: boolean
  /** Visitor analytics are recorded, so the browser sends its page-view beacon. */
  pageViews: boolean
  /** Every locale the site has content in, the default one included. */
  locales: string[]
  /** The site's taxonomies: /{slug} renders that taxonomy's overview page. */
  taxonomies: { slug: string; name: string }[]
  /** Settings → Business (address, phone, opening hours), when any is set. */
  business: BusinessInfo | null
  /** Settings → Podcast, when it's on. */
  podcast: { title: string; feedUrl: string; contentType: string } | null
  /** Mailing-list signup texts for the popup and the Signup box block. */
  signup: PublicSignupSettings
  /** The shop, when it's on (Admin → Shop). */
  shop: { currency: string; pricesIncludeTax: boolean } | null
  seo: PublicSiteSeo
}
