import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { ensureInboundHandle, mailboxAddresses } from '../../../utils/inbox'
import { getEmailBinding } from '../../../utils/cf-env'
import { resolveSetting } from '../../../utils/settings'
import { mailboxes, sites } from '@nuxflow/db/schema'
import { and, asc, eq } from 'drizzle-orm'

/**
 * Inbox mailboxes plus everything the setup panel needs to explain how mail reaches them:
 * the site's own domain, the shared platform address (if the operator configured one),
 * and whether replies can go out through Cloudflare.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [site, rows, handle, provider] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
    db.query.mailboxes.findMany({
      where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.kind, 'inbox')),
      orderBy: [asc(mailboxes.createdAt)],
    }),
    ensureInboundHandle(event, db, siteId),
    resolveSetting(event, 'email.provider', 'emailProvider'),
  ])
  const siteDomain = site?.domain ?? ''
  const platformDomain = String(useRuntimeConfig().inboundEmailDomain ?? '').trim() || null

  return {
    mailboxes: rows.map(m => ({
      id: m.id,
      localPart: m.localPart,
      name: m.name,
      forwardTo: m.forwardTo,
      notify: m.notify,
      enabled: m.enabled,
      createdAt: m.createdAt,
      ...mailboxAddresses(m.localPart, siteDomain, handle),
    })),
    setup: {
      siteDomain: siteDomain.replace(/^www\./, '').split(':')[0],
      platformDomain,
      handle,
      emailProvider: provider || 'console',
      sendingBindingPresent: !!getEmailBinding(event),
    },
  }
})
