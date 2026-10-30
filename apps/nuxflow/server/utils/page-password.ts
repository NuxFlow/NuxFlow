import type { H3Event } from 'h3'
import { argon2Hash, argon2Verify } from './argon2'
import { constantTimeEqualHex, hmacSha256Hex } from './webhook-crypto'
import { getUserSiteRole, hasSuperAdminRole, roleAtLeast, type Role } from './permissions'
import { useDb } from './db'
import { httpError } from './response'

/**
 * Password-protected pages (client galleries and the like): `settings.access = 'password'`
 * with an Argon2 `settings.passwordHash`, which makes the item's `visibility` 'password'
 * (deriveVisibilityFromSettings). Like 'members', anything that lists or serves only
 * `visibility = 'public'` items (sitemaps, feeds, search, llms.txt, Markdown copies, the
 * Posts block…) leaves these out without further work.
 *
 * A visitor who enters the password gets a signed, HttpOnly cookie for that page (and its
 * translations). The signature covers the stored hash, so changing the password locks out
 * everyone who had the old one. Any such cookie also makes the request ineligible for the
 * full-page cache (page-cache.ts only ignores cookies it knows), so an unlocked page is
 * never stored or served from there.
 */

export const PASSWORD_ACCESS = 'password'
export const PAGE_PASSWORD_MIN_LENGTH = 4
export const PAGE_PASSWORD_MAX_LENGTH = 128
const UNLOCK_TTL_SECONDS = 30 * 24 * 60 * 60

type Settings = Record<string, unknown>

/**
 * The settings to store when content is created or updated. `incoming` is what the editor
 * sent (never trusted to carry a hash), `existing` what's stored, `newPassword` the
 * write-only plaintext. The hash is kept when the page stays password-protected without a
 * new password, and dropped when it stops being one. Returns undefined when nothing about
 * settings changes.
 */
export async function resolvePageSettings(
  incoming: Settings | null | undefined,
  existing: Settings | null | undefined,
  newPassword?: string | null,
): Promise<Settings | undefined> {
  if (incoming === undefined && !newPassword) return undefined
  const next: Settings = { ...(incoming ?? existing ?? {}) }
  delete next.passwordHash
  if (next.access !== PASSWORD_ACCESS) return next

  if (newPassword) {
    if (newPassword.length < PAGE_PASSWORD_MIN_LENGTH || newPassword.length > PAGE_PASSWORD_MAX_LENGTH) {
      validationError(`The page password must be ${PAGE_PASSWORD_MIN_LENGTH}–${PAGE_PASSWORD_MAX_LENGTH} characters`)
    }
    next.passwordHash = await argon2Hash(newPassword)
  }
  else if (typeof existing?.passwordHash === 'string' && existing.passwordHash) {
    next.passwordHash = existing.passwordHash
  }
  else {
    validationError('Set a password for this page')
  }
  return next
}

/** Settings as shown to the admin editor: the hash removed, `hasPassword` instead. */
export function settingsForEditor(settings: Settings | null | undefined): Settings | null {
  if (!settings) return settings ?? null
  const { passwordHash, ...rest } = settings
  return { ...rest, hasPassword: typeof passwordHash === 'string' && passwordHash.length > 0 }
}

function storedHash(item: { settings: Settings | null | undefined }): string | null {
  const hash = item.settings?.passwordHash
  return typeof hash === 'string' && hash ? hash : null
}

/** Pages and their translations share one unlock. */
function unlockKey(item: { id: string; sourceItemId?: string | null }): string {
  return item.sourceItemId || item.id
}

export function unlockCookieName(item: { id: string; sourceItemId?: string | null }): string {
  return `nf_unlock_${unlockKey(item)}`
}

function secret(): string {
  const value = useRuntimeConfig().betterAuthSecret as string | undefined
  // Fail with a clear message rather than Web Crypto's "HMAC key length (0)".
  if (!value) throw httpError({ status: 500, message: 'NUXT_BETTER_AUTH_SECRET is not set' })
  return value
}

async function unlockSignature(siteId: string, item: { id: string; sourceItemId?: string | null }, expires: number, hash: string) {
  return hmacSha256Hex(secret(), `page-unlock:${siteId}:${unlockKey(item)}:${expires}:${hash}`)
}

/** True when the request carries a valid, unexpired unlock cookie for this page's current password. */
export async function hasValidUnlock(
  event: H3Event,
  siteId: string,
  item: { id: string; sourceItemId?: string | null; settings: Settings | null | undefined },
): Promise<boolean> {
  const hash = storedHash(item)
  if (!hash) return false
  const raw = getCookie(event, unlockCookieName(item))
  const m = raw ? /^(\d{1,12})\.([0-9a-f]{64})$/.exec(raw) : null
  if (!m) return false
  const expires = Number(m[1])
  if (expires * 1000 < Date.now()) return false
  return constantTimeEqualHex(m[2]!, await unlockSignature(siteId, item, expires, hash))
}

/** Checks the password; on success sets the unlock cookie. */
export async function unlockPage(
  event: H3Event,
  siteId: string,
  item: { id: string; sourceItemId?: string | null; settings: Settings | null | undefined },
  password: string,
): Promise<boolean> {
  const hash = storedHash(item)
  if (!hash || !(await argon2Verify(hash, password))) return false
  const expires = Math.floor(Date.now() / 1000) + UNLOCK_TTL_SECONDS
  setCookie(event, unlockCookieName(item), `${expires}.${await unlockSignature(siteId, item, expires, hash)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestURL(event).protocol === 'https:',
    path: '/',
    maxAge: UNLOCK_TTL_SECONDS,
  })
  return true
}

/** Signed-in team members (author and up, or a super admin) see protected pages without the password. */
export async function isSiteStaff(event: H3Event, siteId: string): Promise<boolean> {
  const session = await getAuthSession(event).catch(() => null)
  const userId = session?.user?.id as string | undefined
  if (!userId) return false
  const db = useDb(event)
  const row = await getUserSiteRole(db, userId, siteId)
  if (row && roleAtLeast(row.role as Role, 'author')) return true
  return hasSuperAdminRole(db, userId)
}
