import type { H3Event } from 'h3'
import { and, eq, gt, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { siteAuthCodes, siteSessions, sessions, users } from '@nuxflow/db/schema'
import { useDb } from './db'
import { bufferToHex } from './buffer'
import { getAccountsOrigin } from './accounts-origin'

// ── Site sessions: a login that is valid on one site's own domain only ─────────────────
//
// Flow (central sign-in — see accounts-origin.ts for why it exists):
//
//   1. site.com/_nuxflow/auth/start      sets a short-lived `state` cookie on site.com and
//                                        sends the browser to the accounts origin.
//   2. accounts…/authorize               the person signs in there (if they aren't already)
//                                        and confirms; the server stores a one-time code
//                                        bound to (user, site, accounts session) and sends
//                                        the browser back to site.com's callback.
//   3. site.com/_nuxflow/auth/callback   checks `state` against its cookie (so nobody can
//                                        push their own login into someone else's
//                                        browser), consumes the code server-side and sets
//                                        the site-session cookie.
//
// The site-session cookie is host-only with the `__Host-` prefix, so a sibling subdomain
// can't set or overwrite it, and it's checked against the site the request is for — a
// cookie from one site is worthless on any other. It never grants account-wide actions
// (password, passkeys, account deletion/export), which only accept an accounts-origin
// session (requireAccountSession in auth.ts).

export const SITE_SESSION_TTL_MS = 7 * 86_400_000
// Sliding expiry is refreshed at most this often (mirrors Better Auth's updateAge default).
const SITE_SESSION_REFRESH_MS = 86_400_000
const AUTH_CODE_TTL_MS = 60_000
export const AUTH_STATE_COOKIE = 'nuxflow_auth_state'
const AUTH_STATE_TTL_SECONDS = 600

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(value: string): Promise<string> {
  return bufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

function isSecureDeployment(): boolean {
  return (getAccountsOrigin() ?? '').startsWith('https:')
}

/** `__Host-` needs Secure, which a plain-http local dev origin can't set. */
export function siteSessionCookieName(): string {
  return isSecureDeployment() ? '__Host-nuxflow_site' : 'nuxflow_site'
}

/**
 * A site's own origin for the handoff redirect, built from its stored domain — never from
 * anything in the request, so a code can only ever be delivered to the real site. Scheme
 * and port follow the accounts origin (both are served by this same Worker; locally that's
 * e.g. http://localhost:8787 next to http://accounts.localhost:8787).
 */
export function siteOriginForDomain(domain: string): string {
  const accounts = getAccountsOrigin()
  const url = new URL(accounts ?? 'https://placeholder.invalid')
  return `${url.protocol}//${domain}${url.port ? `:${url.port}` : ''}`
}

export function siteCallbackUrl(domain: string): string {
  return `${siteOriginForDomain(domain)}/_nuxflow/auth/callback`
}

/** Only same-site relative paths — never `//host`, `/\host` or an absolute URL. */
export function safeReturnPath(value: unknown, fallback = '/admin'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (/[\r\n]/.test(value)) return fallback
  return value
}

// ── Step 1: state cookie on the site's domain ───────────────────────────────────────────

export function beginSiteSignIn(event: H3Event, returnTo: string): string {
  const state = randomToken()
  setCookie(event, AUTH_STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    secure: isSecureDeployment(),
    sameSite: 'lax',
    path: '/_nuxflow/auth',
    maxAge: AUTH_STATE_TTL_SECONDS,
  })
  return state
}

export function readSiteSignInState(event: H3Event): { state: string; returnTo: string } | null {
  const raw = getCookie(event, AUTH_STATE_COOKIE)
  deleteCookie(event, AUTH_STATE_COOKIE, { path: '/_nuxflow/auth' })
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; returnTo?: unknown }
    if (typeof parsed.state !== 'string' || !parsed.state) return null
    return { state: parsed.state, returnTo: safeReturnPath(parsed.returnTo) }
  } catch {
    return null
  }
}

// ── Step 2: one-time code, issued on the accounts origin ────────────────────────────────

export async function issueSiteAuthCode(event: H3Event, input: {
  userId: string
  siteId: string
  parentSessionId: string
  redirectUri: string
}): Promise<string> {
  const code = randomToken()
  await useDb(event).insert(siteAuthCodes).values({
    codeHash: await sha256Hex(code),
    ...input,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  })
  return code
}

// ── Step 3: exchange on the site's domain ───────────────────────────────────────────────

/**
 * Consumes a code (single use — deleted in the same statement that reads it) and returns
 * who it was issued for, or null if it's unknown, expired, for another site, or for a
 * different callback URL.
 */
export async function consumeSiteAuthCode(event: H3Event, code: string, siteId: string, redirectUri: string) {
  const db = useDb(event)
  const [row] = await db.delete(siteAuthCodes)
    .where(eq(siteAuthCodes.codeHash, await sha256Hex(code)))
    .returning()
  if (!row) return null
  if (row.siteId !== siteId || row.redirectUri !== redirectUri) return null
  if (new Date(row.expiresAt).getTime() < Date.now()) return null
  return row
}

export async function createSiteSession(event: H3Event, input: { userId: string; siteId: string; parentSessionId: string }): Promise<void> {
  const token = randomToken()
  await useDb(event).insert(siteSessions).values({
    id: ulid(),
    tokenHash: await sha256Hex(token),
    ...input,
    expiresAt: new Date(Date.now() + SITE_SESSION_TTL_MS).toISOString(),
    ipAddress: getHeader(event, 'cf-connecting-ip') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })
  setCookie(event, siteSessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureDeployment(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SITE_SESSION_TTL_MS / 1000),
  })
}

export interface SiteSessionResult {
  session: { id: string; userId: string; siteId: string; expiresAt: string; parentSessionId: string }
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: string; updatedAt: string }
}

/**
 * The site session presented on this request, if it's valid *for this site*. Revocation
 * is immediate: signing out on the accounts origin, a password reset or account deletion
 * removes the parent `sessions` row, which cascades to every site session it created.
 */
export async function getSiteSession(event: H3Event): Promise<SiteSessionResult | null> {
  const siteId = event.context.siteId as string | null | undefined
  const token = getCookie(event, siteSessionCookieName())
  if (!siteId || !token) return null

  const db = useDb(event)
  const now = new Date().toISOString()
  const [row] = await db.select({
    session: {
      id: siteSessions.id,
      userId: siteSessions.userId,
      siteId: siteSessions.siteId,
      expiresAt: siteSessions.expiresAt,
      parentSessionId: siteSessions.parentSessionId,
      updatedAt: siteSessions.updatedAt,
    },
    user: {
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      image: users.image,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    },
  })
    .from(siteSessions)
    .innerJoin(users, eq(users.id, siteSessions.userId))
    .where(and(
      eq(siteSessions.tokenHash, await sha256Hex(token)),
      eq(siteSessions.siteId, siteId),
      gt(siteSessions.expiresAt, now),
    ))
    .limit(1)
  if (!row) return null

  // Sliding expiry, at most once a day. The parent accounts-origin session is extended
  // with it, so someone who only ever works in a site's admin isn't signed out of the
  // accounts origin (and so of every site) a week after they last visited it.
  const lastRefresh = new Date(row.session.updatedAt.replace(' ', 'T') + (row.session.updatedAt.includes('T') ? '' : 'Z')).getTime()
  if (Number.isFinite(lastRefresh) && Date.now() - lastRefresh > SITE_SESSION_REFRESH_MS) {
    const expiresAt = new Date(Date.now() + SITE_SESSION_TTL_MS).toISOString()
    await db.batch([
      db.update(siteSessions).set({ expiresAt, updatedAt: sql`(datetime('now'))` }).where(eq(siteSessions.id, row.session.id)),
      db.update(sessions).set({ expiresAt }).where(and(eq(sessions.id, row.session.parentSessionId), sql`${sessions.expiresAt} < ${expiresAt}`)),
    ])
    row.session.expiresAt = expiresAt
  }

  const { updatedAt: _updatedAt, ...session } = row.session
  return { session, user: row.user }
}

export async function destroySiteSession(event: H3Event): Promise<void> {
  const token = getCookie(event, siteSessionCookieName())
  deleteCookie(event, siteSessionCookieName(), { path: '/', secure: isSecureDeployment() })
  if (!token) return
  await useDb(event).delete(siteSessions).where(eq(siteSessions.tokenHash, await sha256Hex(token)))
}
