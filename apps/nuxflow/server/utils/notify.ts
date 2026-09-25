import type { H3Event } from 'h3'
import { useDb } from './db'
import { sendTemplatedEmail } from './email-template'
import { sendPushToUser } from './webpush'
import { notifications, notificationPreferences, sites, users, userSiteRoles } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { roleAtLeast, type Role } from './permissions'

const ALL_ROLES: Role[] = ['super_admin', 'admin', 'editor', 'author', 'member', 'viewer']

export interface NotificationTypeDef {
  label: string
  description: string
  /** Default channel state when the user has no preference row. */
  email: boolean
  push: boolean
  /** Always emailed regardless of preference — security alerts. */
  mandatoryEmail?: boolean
  /** Only shown in a user's preferences if their role on the site is at least this. */
  minRole?: Role
}

/**
 * Every notification type the app sends. The admin preferences screen is generated from
 * this, so a type sent without an entry here can't be opted out of — add new types here
 * first. `security.*` types are mandatory by design: their whole purpose is to reach the
 * account owner when someone else may be using the account.
 */
export const NOTIFICATION_TYPES: Record<string, NotificationTypeDef> = {
  'security.new_sign_in': { label: 'New sign-in', description: 'Someone signed in to your account from a new device or location.', email: true, push: true, mandatoryEmail: true },
  'security.password_changed': { label: 'Password changed', description: 'Your password was changed or reset.', email: true, push: true, mandatoryEmail: true },
  'security.passkey_added': { label: 'Passkey added', description: 'A passkey was registered on your account.', email: true, push: true, mandatoryEmail: true },
  'security.passkey_removed': { label: 'Passkey removed', description: 'A passkey was removed from your account.', email: true, push: true, mandatoryEmail: true },
  'security.api_key_created': { label: 'API key created', description: 'A new API key was created for your account.', email: true, push: true, mandatoryEmail: true },
  'security.role_changed': { label: 'Role changed', description: 'Your role on this site changed.', email: true, push: true, mandatoryEmail: true },
  'inbox.message': { label: 'New inbox email', description: 'An email arrived at one of this site\'s inbox addresses.', email: true, push: true, minRole: 'editor' },
  'content.post_by_email': { label: 'Draft from email', description: 'An email you sent to your posting address became a draft.', email: true, push: false, minRole: 'author' },
  'system.plugin_installed': { label: 'Plugin installed', description: 'A dynamic plugin was installed or updated on this site.', email: true, push: false, minRole: 'admin' },
  'system.db_export': { label: 'Database exported', description: 'A full database export was downloaded.', email: true, push: false, minRole: 'admin' },
  'system.site_status': { label: 'Site status changed', description: 'This site was put into maintenance, suspended, or reactivated.', email: true, push: true, minRole: 'admin' },
  'form_submission': { label: 'Form confirmations', description: 'Confirmation when you submit a form on this site.', email: false, push: true },
  'payment_confirmation': { label: 'Payment confirmations', description: 'Your membership payment went through.', email: false, push: true },
  'stale_content': { label: 'Content review reminders', description: 'Content you wrote hasn\'t been updated in a long time.', email: false, push: false, minRole: 'author' },
}

interface NotifyOptions {
  siteId: string
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  /**
   * Also send an email. Honoured subject to the user's preference for this type, except
   * for mandatoryEmail types, which are always emailed.
   */
  sendEmailNotification?: boolean
  /** Also send a browser push notification (requires VAPID keys configured). */
  sendPush?: boolean
  /** Deep link — used for the push click-through and the email's button. Site-relative OK. */
  pushUrl?: string
  /** Button label in the email; defaults to "Open". */
  actionLabel?: string
}

async function channelPrefs(event: H3Event, opts: { siteId: string; userId: string; type: string }): Promise<{ email: boolean; push: boolean }> {
  const def = NOTIFICATION_TYPES[opts.type]
  const defaults = { email: def?.email ?? true, push: def?.push ?? true }
  const row = await useDb(event).query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, opts.userId),
      eq(notificationPreferences.siteId, opts.siteId),
      eq(notificationPreferences.type, opts.type),
    ),
    columns: { email: true, push: true },
  })
  const prefs = row ?? defaults
  return { email: def?.mandatoryEmail ? true : prefs.email, push: prefs.push }
}

/** `https://<site domain>` — email links must be absolute, and a system event has no request URL. */
export async function siteOrigin(event: H3Event, siteId: string): Promise<string> {
  const site = await useDb(event).query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } })
  const domain = site?.domain ?? getHeader(event, 'host') ?? 'localhost'
  const isLocal = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(domain)
  return `${isLocal ? 'http' : 'https'}://${domain}`
}

export async function sendNotification(opts: NotifyOptions, event: H3Event) {
  const db = useDb(event)

  await db.insert(notifications).values({
    id: ulid(),
    siteId: opts.siteId,
    userId: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    // A site-relative deep link rides along in data so the admin bell can open it.
    data: opts.pushUrl?.startsWith('/') ? { ...opts.data, url: opts.pushUrl } : opts.data,
  })

  if (!opts.sendEmailNotification && !opts.sendPush) return
  const prefs = await channelPrefs(event, opts)

  if (opts.sendEmailNotification && prefs.email) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, opts.userId),
      columns: { email: true, name: true },
    })

    if (user?.email) {
      const actionUrl = opts.pushUrl
        ? (/^https?:\/\//.test(opts.pushUrl) ? opts.pushUrl : `${await siteOrigin(event, opts.siteId)}${opts.pushUrl}`)
        : undefined
      await sendTemplatedEmail(event, {
        to: user.email,
        subject: opts.title,
        category: opts.type.startsWith('security.') ? 'security' : 'notification',
        template: {
          heading: opts.title,
          paragraphs: [opts.body],
          action: actionUrl ? { label: opts.actionLabel ?? 'Open', url: actionUrl } : undefined,
          footnote: NOTIFICATION_TYPES[opts.type]?.mandatoryEmail
            ? 'Security alerts are always emailed. If this wasn\'t you, reset your password and review your account\'s passkeys and API keys.'
            : 'You can change which emails you receive under Account → Notifications.',
        },
      }).catch(err => console.error('[notify] Email delivery failed:', err))
    }
  }

  if (opts.sendPush && prefs.push) {
    await sendPushToUser(event, opts.userId, {
      title: opts.title,
      body: opts.body,
      url: opts.pushUrl,
      data: opts.data,
    }).catch(err => console.error('[notify] Push delivery failed:', err))
  }
}

/**
 * Fans a notification out to every member of the site whose role is at least `minRole`
 * (e.g. every editor+ for a new inbox email). Deliveries run sequentially — the audience
 * is a site's staff, a handful of people, and sequential keeps D1 subrequest use flat.
 * Returns how many users were notified.
 */
export async function notifySiteRole(
  event: H3Event,
  opts: Omit<NotifyOptions, 'userId'> & { minRole: Role; excludeUserId?: string },
): Promise<number> {
  const allowed = ALL_ROLES.filter(r => roleAtLeast(r, opts.minRole))
  const rows = await useDb(event).query.userSiteRoles.findMany({
    where: and(eq(userSiteRoles.siteId, opts.siteId), inArray(userSiteRoles.role, allowed)),
    columns: { userId: true },
  })
  const { minRole: _minRole, excludeUserId, ...rest } = opts
  // Each user can belong to the site only once, but guard against duplicate rows anyway.
  const seen = new Set<string>()
  let count = 0
  for (const { userId } of rows) {
    if (userId === excludeUserId || seen.has(userId)) continue
    seen.add(userId)
    try {
      await sendNotification({ ...rest, userId }, event)
      count++
    }
    catch (err) {
      console.error('[notify] Fan-out delivery failed for', userId, err)
    }
  }
  return count
}
