import type { H3Event } from 'h3'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { notifications, sites } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { createSystemEvent } from './system-event'
import { getExecutionContext, waitUntil } from './cf-env'
import { sendNotification } from './notify'

/**
 * Security alerts — emails (always, regardless of preferences — see NOTIFICATION_TYPES in
 * notify.ts) plus in-app/push notices when something sensitive happens on an account.
 *
 * `/api/auth/**` bypasses multi-site resolution (02.multi-site.ts), so these resolve the
 * site from the Host header themselves and run on a system event scoped to it.
 */

export async function resolveSiteIdForHost(db: Db, host: string): Promise<string | null> {
  const hostname = host.split(':')[0]!.toLowerCase()
  const site = await db.query.sites.findFirst({
    where: inArray(sites.domain, [host, hostname]),
    columns: { id: true },
  })
  if (site) return site.id
  // Same single-site fallback 02.multi-site.ts uses.
  const all = await db.query.sites.findMany({ columns: { id: true }, limit: 2 })
  return all.length === 1 ? all[0]!.id : null
}

/** A system event for the site the given request's Host belongs to, or null. */
export async function siteEventForRequest(event: H3Event): Promise<H3Event | null> {
  const host = getHeader(event, 'host') ?? ''
  const siteId = (event.context.siteId as string | undefined) ?? await resolveSiteIdForHost(useDb(event), host)
  if (!siteId) return null
  return createSystemEvent({
    env: event.context.cloudflare?.env ?? (globalThis as { __env__?: unknown }).__env__,
    ctx: getExecutionContext(event) ?? undefined,
    siteId,
    host: host.split(':')[0],
  })
}

/** "Chrome on Windows" — coarse on purpose; version bumps must not look like a new device. */
export function describeUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  const s = ua ?? ''
  const browser = /edg\//i.test(s) ? 'Edge'
    : /opr\/|opera/i.test(s) ? 'Opera'
      : /firefox\//i.test(s) ? 'Firefox'
        : /chrome\/|crios\//i.test(s) ? 'Chrome'
          : /safari\//i.test(s) ? 'Safari'
            : 'an unknown browser'
  const os = /windows/i.test(s) ? 'Windows'
    : /iphone|ipad|ios/i.test(s) ? 'iOS'
      : /mac os x|macintosh/i.test(s) ? 'macOS'
        : /android/i.test(s) ? 'Android'
          : /linux/i.test(s) ? 'Linux'
            : 'an unknown system'
  return { browser, os }
}

function nowUtc(): string {
  return `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`
}

export async function sendSecurityAlert(siteEvent: H3Event, userId: string, type: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  await sendNotification({
    siteId: siteEvent.context.siteId as string,
    userId,
    type,
    title,
    body,
    data,
    sendEmailNotification: true,
    sendPush: true,
  }, siteEvent)
}

/**
 * Alerts on a sign-in from a browser/OS/country combination this user hasn't signed in
 * from before. The notifications table doubles as the device history (same dedupe trick
 * as stale-content-scan.ts), so no schema is needed for it. A user's very first recorded
 * sign-in only gets a silent in-app entry — there's nothing to compare it against, and
 * every invitee's first login would otherwise email them a scary alert.
 */
export async function alertOnNewSignIn(requestEvent: H3Event, session: { userId: string; userAgent?: string | null; ipAddress?: string | null }): Promise<void> {
  const siteEvent = await siteEventForRequest(requestEvent)
  if (!siteEvent) return
  const db = useDb(siteEvent)

  const { browser, os } = describeUserAgent(session.userAgent)
  const country = getHeader(requestEvent, 'cf-ipcountry') ?? ''
  const fingerprint = `${browser}|${os}|${country}`
  const type = 'security.new_sign_in'

  const [seenDevice, seenAny] = await Promise.all([
    db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, session.userId), eq(notifications.type, type), sql`json_extract(${notifications.data}, '$.fingerprint') = ${fingerprint}`))
      .limit(1),
    db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, session.userId), eq(notifications.type, type)))
      .limit(1),
  ])
  if (seenDevice.length) return

  const where = [country && `country ${country}`, session.ipAddress && `IP ${session.ipAddress}`].filter(Boolean).join(', ')
  const firstEver = !seenAny.length
  await sendNotification({
    siteId: siteEvent.context.siteId as string,
    userId: session.userId,
    type,
    title: 'New sign-in to your account',
    body: `Your account was signed in to from ${browser} on ${os}${where ? ` (${where})` : ''} at ${nowUtc()}.`,
    data: { fingerprint, ipAddress: session.ipAddress ?? null },
    sendEmailNotification: !firstEver,
    sendPush: !firstEver,
  }, siteEvent)
}

/** Better Auth endpoints whose success is itself a security event, keyed by pathname. */
export const AUTH_PATH_ALERTS: Record<string, { type: string; title: string; body: string }> = {
  // Fired from onPasswordReset in better-auth.ts (the resetting user isn't signed in, so
  // the middleware's session lookup can't see them).
  '/api/auth/reset-password': {
    type: 'security.password_changed',
    title: 'Your password was reset',
    body: 'The password for your account was reset using an emailed reset link, and all other sessions were signed out.',
  },
  '/api/auth/change-password': {
    type: 'security.password_changed',
    title: 'Your password was changed',
    body: 'The password for your account was just changed.',
  },
  '/api/auth/passkey/verify-registration': {
    type: 'security.passkey_added',
    title: 'A passkey was added to your account',
    body: 'A new passkey can now be used to sign in to your account.',
  },
  '/api/auth/passkey/register': {
    type: 'security.passkey_added',
    title: 'A passkey was added to your account',
    body: 'A new passkey can now be used to sign in to your account.',
  },
  '/api/auth/passkey/delete-passkey': {
    type: 'security.passkey_removed',
    title: 'A passkey was removed from your account',
    body: 'A passkey was removed and can no longer be used to sign in.',
  },
}

export async function alertForAuthPath(requestEvent: H3Event, userId: string, pathname: string): Promise<void> {
  const alert = AUTH_PATH_ALERTS[pathname]
  if (!alert) return
  const siteEvent = await siteEventForRequest(requestEvent)
  if (!siteEvent) return
  const { browser, os } = describeUserAgent(getHeader(requestEvent, 'user-agent'))
  await sendSecurityAlert(siteEvent, userId, alert.type, alert.title, `${alert.body} This happened from ${browser} on ${os} at ${nowUtc()}.`)
}

/** For routes that already run with a site context (/api/v1/**). Background, never throws. */
export function alertInBackground(event: H3Event, userId: string, type: string, title: string, body: string): void {
  waitUntil(event, sendSecurityAlert(event, userId, type, title, body)
    .catch(err => console.error(`[security-alerts] ${type} failed:`, err)))
}

export function alertRoleChanged(event: H3Event, targetUserId: string, before: string | undefined, after: string): void {
  const roleLabel = (r: string) => r.replace('_', ' ')
  alertInBackground(
    event,
    targetUserId,
    'security.role_changed',
    'Your role was changed',
    before
      ? `Your role on this site changed from ${roleLabel(before)} to ${roleLabel(after)} at ${nowUtc()}.`
      : `You were given the ${roleLabel(after)} role on this site at ${nowUtc()}.`,
  )
}
