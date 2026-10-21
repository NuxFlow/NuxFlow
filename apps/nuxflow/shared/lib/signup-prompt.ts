import { z } from 'zod'

/**
 * Mailing-list signup settings (Admin → Mailing list → Signup popup), stored as one JSON
 * value under the `mailing_list.signup` site setting. Shared by the server (validation,
 * the public site payload) and the app (the settings form, the popup's trigger logic).
 *
 * The defaults are deliberately the polite ones: a corner slide-in rather than a modal,
 * shown once the visitor is reading (half-way down a page, or on their second page) rather
 * than on a timer, and kept away for 30 days once closed.
 */

export const SIGNUP_STYLES = ['slide-in', 'modal'] as const
export const SIGNUP_TRIGGERS = ['engaged', 'exit', 'delay'] as const

export type SignupStyle = typeof SIGNUP_STYLES[number]
export type SignupTrigger = typeof SIGNUP_TRIGGERS[number]

// Accepts site-relative paths (`/_nuxflow/media/…`, what binding-only R2 returns) and http(s).
const imageUrl = z.string().trim().max(2000)
  .refine(v => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v), 'Must be a web address or a site path')
const rewardUrl = z.string().trim().max(2000)
  .refine(v => v === '' || (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\//i.test(v), 'Must be a web address or a site path')

export const signupSettingsSchema = z.object({
  /** Show the popup. The Signup box block works whether this is on or not. */
  popupEnabled: z.boolean().default(false),
  heading: z.string().trim().min(1).max(120).default('Get new posts by email'),
  body: z.string().trim().max(500).default('Join the mailing list. No spam, and you can unsubscribe at any time.'),
  buttonLabel: z.string().trim().min(1).max(40).default('Subscribe'),
  imageUrl: imageUrl.default(''),
  collectName: z.boolean().default(false),
  /** Shown under the form and stored with each signup as the record of what they agreed to. */
  consentText: z.string().trim().max(500).default('We\'ll only email you about this site. Unsubscribe any time.'),
  successHeading: z.string().trim().min(1).max(120).default('Thanks for subscribing!'),
  successBody: z.string().trim().max(500).default(''),
  /**
   * The incentive, if there is one: a discount code, a download, a free trial. Never sent
   * in the public site payload — it is revealed only after signing up (or, with double
   * opt-in, after confirming), so it can't be read without joining.
   */
  rewardText: z.string().trim().max(500).default(''),
  rewardUrl: rewardUrl.default(''),
  rewardLabel: z.string().trim().max(60).default(''),
  style: z.enum(SIGNUP_STYLES).default('slide-in'),
  trigger: z.enum(SIGNUP_TRIGGERS).default('engaged'),
  delaySeconds: z.number().int().min(5).max(300).default(30),
  scrollPercent: z.number().int().min(10).max(90).default(50),
  /** Days the popup stays away after a visitor closes it. */
  hideDays: z.number().int().min(1).max(365).default(30),
  /** Path prefixes the popup never shows on (`/checkout`, `/contact`). */
  excludePaths: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  showOnMobile: z.boolean().default(true),
  /** Send a "confirm your subscription" email first. Needs a third-party email provider. */
  doubleOptIn: z.boolean().default(true),
  /** Brevo contact list to copy confirmed subscribers to (uses the site's Brevo API key). */
  brevoListId: z.number().int().positive().nullable().default(null),
})

export type SignupSettings = z.infer<typeof signupSettingsSchema>

export const DEFAULT_SIGNUP_SETTINGS: SignupSettings = signupSettingsSchema.parse({})

/** Reads a stored value leniently: anything invalid falls back to its default, never throws. */
export function parseSignupSettings(raw: unknown): SignupSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SIGNUP_SETTINGS }
  const out: Record<string, unknown> = { ...DEFAULT_SIGNUP_SETTINGS }
  const shape = signupSettingsSchema.shape
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = shape[key as keyof typeof shape]
    if (!field) continue
    const parsed = field.safeParse(value)
    if (parsed.success) out[key] = parsed.data
  }
  return out as SignupSettings
}

/** What the public site payload carries — everything except the reward and list sync. */
export type PublicSignupSettings = Omit<SignupSettings, 'rewardText' | 'rewardUrl' | 'rewardLabel' | 'brevoListId'>

export function publicSignupSettings(s: SignupSettings): PublicSignupSettings {
  const { rewardText: _t, rewardUrl: _u, rewardLabel: _l, brevoListId: _b, ...rest } = s
  return rest
}

export interface SignupReward {
  text: string
  url: string
  label: string
}

export function signupReward(s: SignupSettings): SignupReward | null {
  if (!s.rewardText && !s.rewardUrl) return null
  return { text: s.rewardText, url: s.rewardUrl, label: s.rewardLabel || 'Get it now' }
}

/** True when `path` is under one of the excluded prefixes (`/shop` covers `/shop/cart`, not `/shopping`). */
export function isExcludedPath(path: string, excludePaths: string[]): boolean {
  const p = path.toLowerCase().replace(/\/+$/, '') || '/'
  return excludePaths.some((raw) => {
    const trimmed = raw.trim().toLowerCase()
    // A bare "/" means the homepage only, not every page.
    if (trimmed === '/') return p === '/'
    const prefix = trimmed.replace(/\/+$/, '')
    if (!prefix) return false
    const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`
    return p === normalized || p.startsWith(`${normalized}/`)
  })
}

/** Pages the popup never appears on, whatever the settings say. */
const NEVER_ON = ['/admin', '/account', '/login', '/register', '/forgot-password', '/reset-password', '/setup', '/authorize', '/mailing-list']

export function isBuiltInExcludedPath(path: string): boolean {
  return isExcludedPath(path, NEVER_ON)
}

/** localStorage key for SignupVisitorState (dismissedAt, subscribed). */
export const SIGNUP_STORAGE_KEY = 'nuxflow_signup'
/** sessionStorage key: pages viewed this session, and whether the popup was already counted as shown. */
export const SIGNUP_SESSION_KEY = 'nuxflow_signup_session'

/** Browser-side memory of the visitor (localStorage — a cookie would turn off page caching). */
export interface SignupVisitorState {
  /** ms timestamp the popup was last closed. */
  dismissedAt?: number
  /** Set once the visitor signed up through the popup or a Signup box. */
  subscribed?: boolean
}

export function isSuppressed(state: SignupVisitorState, hideDays: number, now = Date.now()): boolean {
  if (state.subscribed) return true
  if (state.dismissedAt && now - state.dismissedAt < hideDays * 86_400_000) return true
  return false
}
