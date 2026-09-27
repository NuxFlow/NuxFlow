import type { InjectionKey, Ref } from 'vue'

/** Admin → SEO settings form, shared by the page and its settings tabs via provide/inject. */
export interface SeoSettingsForm {
  title: string
  description: string
  canonicalUrl: string
  ogImage: string
  robots: 'index' | 'noindex'
  aiCrawlers: 'allow' | 'block-training' | 'disallow'
  robotsCustom: string
  twitterHandle: string
  /** One URL per line in the form; stored as an array. */
  socialProfiles: string
  verifyGoogle: string
  verifyBing: string
  verifyYandex: string
  verifyPinterest: string
  noindexTaxonomies: boolean
  noindexContentTypes: string[]
  llmsEnabled: boolean
  llmsIntro: string
  markdownEnabled: boolean
  indexnowEnabled: boolean
  indexnowKey: string
  redirectToPrimary: boolean
}

export interface SeoFormContext {
  form: SeoSettingsForm
  saving: Ref<boolean>
  save: () => Promise<void>
  siteName: Ref<string>
  siteDomain: Ref<string>
}

export const SEO_FORM_KEY: InjectionKey<SeoFormContext> = Symbol('seo-form')

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return typeof v === 'string' && v ? v.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : []
}

export function emptySeoForm(): SeoSettingsForm {
  return {
    title: '', description: '', canonicalUrl: '', ogImage: '', robots: 'index', aiCrawlers: 'allow', robotsCustom: '',
    twitterHandle: '', socialProfiles: '', verifyGoogle: '', verifyBing: '', verifyYandex: '', verifyPinterest: '',
    noindexTaxonomies: false, noindexContentTypes: [], llmsEnabled: true, llmsIntro: '', markdownEnabled: true,
    indexnowEnabled: false, indexnowKey: '', redirectToPrimary: false,
  }
}

/** Stored `seo.*` settings → form values (tolerates legacy string booleans). */
export function seoFormFromSettings(s: Record<string, unknown>): SeoSettingsForm {
  const ai = asString(s['seo.ai_crawlers'])
  return {
    title: asString(s['seo.title']),
    description: asString(s['seo.description']),
    canonicalUrl: asString(s['seo.canonical_url']),
    ogImage: asString(s['seo.og_image']),
    robots: s['seo.robots'] === 'noindex' ? 'noindex' : 'index',
    aiCrawlers: ai === 'disallow' || ai === 'block-training' ? ai : 'allow',
    robotsCustom: asString(s['seo.robots_custom']),
    twitterHandle: asString(s['seo.twitter_handle']),
    socialProfiles: asList(s['seo.social_profiles']).join('\n'),
    verifyGoogle: asString(s['seo.verify_google']),
    verifyBing: asString(s['seo.verify_bing']),
    verifyYandex: asString(s['seo.verify_yandex']),
    verifyPinterest: asString(s['seo.verify_pinterest']),
    noindexTaxonomies: asBool(s['seo.noindex_taxonomies'], false),
    noindexContentTypes: asList(s['seo.noindex_content_types']),
    llmsEnabled: asBool(s['seo.llms_enabled'], true),
    llmsIntro: asString(s['seo.llms_intro']),
    markdownEnabled: asBool(s['seo.markdown_enabled'], true),
    indexnowEnabled: asBool(s['seo.indexnow_enabled'], false),
    indexnowKey: asString(s['seo.indexnow_key']),
    redirectToPrimary: asBool(s['seo.redirect_to_primary'], false),
  }
}

/** Form values → the `settings` map PATCH /api/v1/settings expects (server validates). */
export function seoFormToSettings(f: SeoSettingsForm): Record<string, unknown> {
  return {
    'seo.title': f.title.trim(),
    'seo.description': f.description.trim(),
    'seo.canonical_url': f.canonicalUrl.trim(),
    'seo.og_image': f.ogImage.trim(),
    'seo.robots': f.robots,
    'seo.ai_crawlers': f.aiCrawlers,
    'seo.robots_custom': f.robotsCustom,
    'seo.twitter_handle': f.twitterHandle.trim(),
    'seo.social_profiles': f.socialProfiles.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    'seo.verify_google': f.verifyGoogle.trim(),
    'seo.verify_bing': f.verifyBing.trim(),
    'seo.verify_yandex': f.verifyYandex.trim(),
    'seo.verify_pinterest': f.verifyPinterest.trim(),
    'seo.noindex_taxonomies': f.noindexTaxonomies,
    'seo.noindex_content_types': f.noindexContentTypes,
    'seo.llms_enabled': f.llmsEnabled,
    'seo.llms_intro': f.llmsIntro,
    'seo.markdown_enabled': f.markdownEnabled,
    'seo.indexnow_enabled': f.indexnowEnabled,
    'seo.redirect_to_primary': f.redirectToPrimary,
  }
}
