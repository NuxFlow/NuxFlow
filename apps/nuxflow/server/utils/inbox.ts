import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { emailMessages, mailboxes, siteSettings, sites } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getCfBindings } from './cf-env'
import { resolveSetting, saveSetting } from './settings'
import { CATCH_ALL_LOCAL_PART, INBOUND_HANDLE_SETTING } from './inbound-email'

export type EmailMessageRow = typeof emailMessages.$inferSelect

export async function getEmailMessageOrThrow(db: Db, siteId: string, id: string): Promise<EmailMessageRow> {
  const row = await db.query.emailMessages.findFirst({
    where: and(eq(emailMessages.id, id), eq(emailMessages.siteId, siteId)),
  })
  if (!row) notFound('Message not found')
  return row
}

/** Removes a message's raw .eml and attachments from R2. Best-effort — never throws. */
export async function deleteEmailObjects(event: H3Event, message: Pick<EmailMessageRow, 'rawKey' | 'attachments'>): Promise<void> {
  const { r2 } = getCfBindings(event)
  if (!r2) return
  const keys = [message.rawKey, ...(message.attachments ?? []).map(a => a.key)].filter((k): k is string => !!k)
  if (!keys.length) return
  try {
    await r2.delete(keys)
  }
  catch (err) {
    console.error('[inbox] Failed to delete R2 objects:', err)
  }
}

/**
 * Deletes every stored email object (raw .eml + attachments) for a site — for site
 * deletion, where the email_messages rows go by FK cascade but R2 has no cascade. Walks
 * the private prefix with R2's paginated list (1000 keys per page). Returns the number of
 * keys deleted; throws on failure so the caller can report incomplete erasure.
 */
export async function deleteSiteEmailObjects(event: H3Event, siteId: string): Promise<number> {
  const { r2 } = getCfBindings(event)
  if (!r2) return 0
  const prefix = `_private/${siteId}/email/`
  let cursor: string | undefined
  let deleted = 0
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 })
    const keys = page.objects.map(o => o.key)
    if (keys.length) {
      await r2.delete(keys)
      deleted += keys.length
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return deleted
}

export const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/

/** Local parts NuxFlow uses itself or that invite abuse; `*` is the catch-all and is allowed. */
export const RESERVED_LOCAL_PARTS = new Set(['postmaster', 'abuse', 'noreply', 'no-reply', 'mailer-daemon'])

export function isValidMailboxLocalPart(local: string): boolean {
  if (local === CATCH_ALL_LOCAL_PART) return true
  // `post-…` is the post-by-email namespace; `+` would collide with sub-addressing.
  return LOCAL_PART_RE.test(local) && !local.startsWith('post-') && !RESERVED_LOCAL_PARTS.has(local)
}

/**
 * The site's handle on the shared platform domain (`<handle>+contact@in.platform.com`),
 * created on first use from the site's domain — `acme.com` → `acme`, with a numeric
 * suffix if another site already has it. Null when no platform domain is configured.
 */
export async function ensureInboundHandle(event: H3Event, db: Db, siteId: string): Promise<string | null> {
  const platform = String(useRuntimeConfig().inboundEmailDomain ?? '').trim()
  if (!platform) return null
  const existing = await resolveSetting(event, INBOUND_HANDLE_SETTING)
  if (typeof existing === 'string' && existing) return existing

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } })
  const base = (site?.domain ?? 'site').replace(/^www\./, '').split('.')[0]!.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'site'
  let handle = base
  for (let n = 2; ; n++) {
    const taken = await db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.key, INBOUND_HANDLE_SETTING), eq(siteSettings.value, handle)),
      columns: { id: true },
    })
    if (!taken) break
    handle = `${base}${n}`
  }
  await saveSetting(event, INBOUND_HANDLE_SETTING, handle)
  return handle
}

/** Addresses a mailbox answers on — the site's own domain and, if configured, the platform domain. */
export function mailboxAddresses(localPart: string, siteDomain: string, handle: string | null): { siteAddress: string; platformAddress: string | null } {
  const domain = siteDomain.replace(/^www\./, '').split(':')[0]!
  const platform = String(useRuntimeConfig().inboundEmailDomain ?? '').trim()
  const isCatchAll = localPart === CATCH_ALL_LOCAL_PART
  return {
    siteAddress: isCatchAll ? `*@${domain}` : `${localPart}@${domain}`,
    platformAddress: handle && platform
      ? (isCatchAll ? `${handle}@${platform}` : `${handle}+${localPart}@${platform}`)
      : null,
  }
}

export async function countUnreadInbox(db: Db, siteId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(emailMessages)
    .innerJoin(mailboxes, eq(mailboxes.id, emailMessages.mailboxId))
    .where(and(eq(emailMessages.siteId, siteId), eq(emailMessages.status, 'new'), eq(mailboxes.kind, 'inbox')))
  return row?.n ?? 0
}
