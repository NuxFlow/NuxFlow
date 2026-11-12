// What GET /api/v1/settings sends to Admin → Settings and the other admin pages that read
// settings (SEO, Themes, Business, Podcast, Appointments). Built in
// server/api/v1/settings/index.get.ts, which is checked against this. Import-free.

export interface SiteSettingsResponse {
  site: {
    id: string
    name: string
    domain: string
    locale: string
    timezone: string
    status: 'active' | 'maintenance' | 'suspended'
    isPrimary: boolean
  }
  /**
   * Every stored setting by key (`seo.title`, `theme.primary_color`…). Deliberately a loose
   * map: settings are free-form key-value pairs. Passwords and API keys come back masked.
   */
  settings: Record<string, unknown>
  /** Whether Ollama may be chosen (never for customer sites on a hosting platform). */
  ollamaAvailable: boolean
  /** Whether the site's plan includes Cloudflare Image Transformations. */
  imageTransformationsAvailable: boolean
  /** What the Email tab shows while nothing is saved. */
  emailDefaults: {
    provider: string
    fromAddress: { cloudflare: string; other: string }
  }
}
