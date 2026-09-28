import { z } from 'zod'
import { bufferToHex } from '../../../../utils/buffer'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { clearSiteCache } from '../../../../middleware/02.multi-site'
import { normalizeDomain } from '../../../../utils/domain'
import { isCentralAuth } from '../../../../utils/accounts-origin'
import { created } from '../../../../utils/response'
import { sites, auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  // A second site means a second admin team who can add their own scripts to their own
  // pages — sign-in must move off site domains first (see utils/accounts-origin.ts).
  if (!isCentralAuth()) {
    throw conflict('Set up the central sign-in domain (NUXT_PUBLIC_ACCOUNTS_URL) before adding more sites — see "Hosting several sites" in docs/installation.md.')
  }
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  // Stored exactly as the Host header will present it (see utils/domain.ts).
  const domain = normalizeDomain(body.domain)
  if (!domain) throw validationError('Enter a valid domain, e.g. example.com')
  if (await db.query.sites.findFirst({ where: eq(sites.domain, domain), columns: { id: true } })) {
    throw conflict('Another site already uses that domain')
  }
  body.domain = domain

  const id = ulid()

  // One-time token required to complete /setup for this site — only the hash is persisted,
  // so this is the only chance to hand the raw token to the caller.
  const rawBytes = crypto.getRandomValues(new Uint8Array(32))
  const setupToken = btoa(String.fromCharCode(...rawBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const setupTokenHash = bufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(setupToken)))

  await db.insert(sites).values({ id, ...body, setupCompleted: false, setupTokenHash })

  // writeAuditLog() always scopes the row to event.context.siteId (the acting
  // super admin's CURRENT site from the Host header), which would be the wrong
  // site here — the action targets the newly-created site, not the caller's
  // own. Insert directly, scoped to the new site's real id, mirroring the
  // explicit-siteId pattern deleteSiteCompletely() uses for the same reason.
  await db.insert(auditLogs).values({
    id: ulid(),
    siteId: id,
    userId,
    action: 'create',
    resource: 'site',
    resourceId: id,
    after: { domain: body.domain, name: body.name },
    ipAddress: getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })

  // A request for this domain made just before creation would have cached a
  // "no site" miss — clear it so the new site is picked up immediately.
  clearSiteCache(body.domain)
  return created(event, { id, setupToken })
})
