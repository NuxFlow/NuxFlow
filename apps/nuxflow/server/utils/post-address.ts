import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { mailboxes, sites } from '@nuxflow/db/schema'
import type { Db } from './db'
import { ensureInboundHandle, mailboxAddresses } from './inbox'

/** 24 base-32 chars ≈ 120 bits — the address itself is the first of three auth checks. */
export function generatePostLocalPart(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `post-${Array.from(bytes, b => alphabet[b % alphabet.length]).join('')}`
}

export async function getPostMailbox(db: Db, siteId: string, userId: string) {
  return db.query.mailboxes.findFirst({
    where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.userId, userId), eq(mailboxes.kind, 'post')),
  })
}

export async function describePostAddress(event: H3Event, db: Db, siteId: string, localPart: string) {
  const [site, handle] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
    ensureInboundHandle(event, db, siteId),
  ])
  return mailboxAddresses(localPart, site?.domain ?? '', handle)
}
