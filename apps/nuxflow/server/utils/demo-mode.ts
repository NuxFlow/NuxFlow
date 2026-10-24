import type { H3Event } from 'h3'
import { forbidden } from './response'

// The public demo (demo.nuxflow.dev, wrangler.demo.toml) hands everyone the same admin
// login, so anything that admin can do, any visitor can do. Demo mode keeps the product
// tour (Canvas, posts, media, menus, taxonomies, themes, SEO) and switches off what could
// cost the operator money, abuse their domain, or lock other visitors out:
//
// - AI of every kind (isDemoMode() checks in cf-env.ts, ai-sdk.ts, image-providers) —
//   whatever bindings or keys the Worker happens to have.
// - Requests demoBlockReason() names (03.demo-guard.ts): account/sign-in changes, API
//   keys + MCP, plugins, restore/import, platform screens, video uploads.
// - Settings and content that would put the visitor's own HTML or credentials on the
//   site (demoBlockedSettings(), demoBlockedContent(), checked in the routes).
// - Every response is noindex, so spam left on the demo is worthless to search engines.
//
// Off unless the Worker has NUXT_IS_DEMO = "true" — no other install is affected.

export const DEMO_DISABLED_MESSAGE = 'This is switched off in the live demo.'

/** Largest request body the demo accepts (uploads included). */
export const DEMO_MAX_BODY_BYTES = 2 * 1024 * 1024

// useRuntimeConfig().isDemo is always false in cloudflare-module Workers: [vars] are not
// in process.env, they're on the env binding object — the request's, or globalThis.__env__
// for scheduled tasks.
export function isDemoMode(event?: H3Event | null): boolean {
  const env = event?.context?.cloudflare?.env ?? globalThis.__env__
  return env?.NUXT_IS_DEMO === 'true' || useRuntimeConfig().isDemo === true
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Sign-in and sign-out are the only Better Auth actions the shared login needs; every
// other one (change password/email, passkeys, delete user, reset, social sign-in) would let
// one visitor lock the rest out until the nightly reset.
const ALLOWED_AUTH_ACTIONS = new Set(['/api/auth/sign-in/email', '/api/auth/sign-out'])

// Blocked for every method.
const BLOCKED_PREFIXES = [
  '/api/v1/mcp',
  '/api/v1/ai/',
  '/api/public/listen/',
  '/api/accounts/',
  '/api/v1/admin/',
]

// Blocked for POST/PUT/PATCH/DELETE; reading stays allowed so the screens still open.
const BLOCKED_WRITE_PREFIXES = [
  '/api/v1/api-keys',
  '/api/v1/dynamic-plugins',
  '/api/v1/account',
  '/api/v1/restore',
  '/api/v1/import/',
  '/api/v1/media/video',
  '/api/public/auth/register',
  // The demo is seeded by demo-reset.ts; the first visitor to a fresh database must not
  // be able to run the setup wizard and make themselves super admin.
  '/api/v1/setup/complete',
]

// Allowed exceptions inside BLOCKED_WRITE_PREFIXES.
const ALLOWED_WRITES = new Set(['/api/v1/account/notification-preferences'])

function startsWithSegment(path: string, prefix: string): boolean {
  return prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Why the demo refuses this request, or null when it's allowed. Pure — the path is the
 * pathname without query string or trailing slash.
 */
export function demoBlockReason(method: string, pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  const write = UNSAFE_METHODS.has(method.toUpperCase())

  if (path.startsWith('/api/auth/')) {
    return write && !ALLOWED_AUTH_ACTIONS.has(path) ? DEMO_DISABLED_MESSAGE : null
  }
  if (BLOCKED_PREFIXES.some(p => startsWithSegment(path, p))) return DEMO_DISABLED_MESSAGE
  if (/^\/api\/v1\/users\/[^/]+\/super-admin$/.test(path)) return DEMO_DISABLED_MESSAGE
  // Installing a theme uploads a zip (its demo.json can carry custom HTML); activating the
  // bundled themes, the customizer and CSS edits stay open.
  if (write && path === '/api/v1/themes' && method.toUpperCase() === 'POST') return DEMO_DISABLED_MESSAGE
  if (write && !ALLOWED_WRITES.has(path) && BLOCKED_WRITE_PREFIXES.some(p => startsWithSegment(path, p))) {
    return DEMO_DISABLED_MESSAGE
  }
  return null
}

// Settings whose value is the visitor's own HTML, credentials, or a claim on the domain.
const BLOCKED_SETTING_PREFIXES = [
  'appearance.custom_',
  'ai.',
  'auth.',
  'analytics.',
  'cloudflare.',
  'email.',
  'hosting.',
  'integrations.',
  'media.',
  'payments.',
  'platform.',
  'seo.verify_',
  'seo.canonical_url',
  'seo.redirect_to_primary',
]

interface SettingsPatch {
  domain?: unknown
  status?: unknown
  settings?: Record<string, unknown>
  ai?: unknown
  cloudflare?: unknown
  media?: unknown
  auth?: unknown
}

/** The parts of a `PATCH /api/v1/settings` body the demo refuses (empty = fine). */
export function demoBlockedSettings(body: SettingsPatch): string[] {
  const blocked: string[] = []
  for (const section of ['domain', 'status', 'ai', 'cloudflare', 'media', 'auth'] as const) {
    if (body[section] !== undefined) blocked.push(section)
  }
  for (const key of Object.keys(body.settings ?? {})) {
    if (BLOCKED_SETTING_PREFIXES.some(p => key.startsWith(p))) blocked.push(key)
  }
  return blocked
}

const DEMO_BLOCKED_BLOCK_TYPES = new Set(['html-block/html'])

/** True when content JSON holds a block the demo refuses (the raw HTML block), at any depth. */
export function demoBlockedContent(content: unknown, depth = 0): boolean {
  if (!content || typeof content !== 'object' || depth > 50) return false
  if (Array.isArray(content)) return content.some(c => demoBlockedContent(c, depth + 1))
  const node = content as Record<string, unknown>
  if (typeof node.type === 'string' && DEMO_BLOCKED_BLOCK_TYPES.has(node.type)) return true
  return Object.values(node).some(v => demoBlockedContent(v, depth + 1))
}

export function assertDemoAllowsSettings(event: H3Event, body: SettingsPatch): void {
  if (!isDemoMode(event)) return
  const blocked = demoBlockedSettings(body)
  if (blocked.length) throw forbidden(`${DEMO_DISABLED_MESSAGE} (${blocked.join(', ')})`)
}

export function assertDemoAllowsContent(event: H3Event, content: unknown): void {
  if (isDemoMode(event) && demoBlockedContent(content)) {
    throw forbidden(`The HTML block is switched off in the live demo.`)
  }
}
