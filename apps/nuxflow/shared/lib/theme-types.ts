// What Admin → Themes gets from the server: GET /api/v1/themes (the installed themes) and
// POST /api/v1/themes (installing one). Import-free.

/** An installed theme. Its CSS lives in KV, not here. */
export interface AdminTheme {
  id: string
  name: string
  packageName: string
  version: string
  isActive: boolean
  hasCss: boolean
  /** Bumped on every CSS publish (part of the CSS's KV key). */
  cssVersion: number
  settings: { hasDemoContent?: boolean } | null
  installedAt: string
}

/** How much a theme bundle's demo content would add. */
export interface ThemeDemoSummary {
  pages: number
  posts: number
  menus: number
  forms: number
}

/** POST /api/v1/themes: the theme just installed. */
export interface ThemeUploadResult {
  success: true
  id: string
  hasDemoContent: boolean
  demoSummary: ThemeDemoSummary | null
  /** Bundle images that couldn't be copied into the media library. */
  failedImages?: string[]
}
