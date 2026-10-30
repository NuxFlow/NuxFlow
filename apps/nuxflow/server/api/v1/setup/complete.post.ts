import { z } from 'zod'
import type { H3Event } from 'h3'
import { useDb } from '../../../utils/db'
import { auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { created, httpError } from '../../../utils/response'
import { rateLimit } from '../../../utils/rate-limit'
import { isHttpError } from '../../../utils/errors'
import { clearSiteCache } from '../../../utils/site-resolution'
import { clearSetupStatusCache } from '../../../utils/setup-status'
import { seedNewSite } from '../../../utils/site-seeding'
import {
  authenticateSetupAdmin,
  claimSecondarySite,
  createSetupAdminAccount,
  grantSetupRole,
  isInitialInstall,
  prepareInitialSite,
  saveSetupSettings,
} from '../../../utils/setup-wizard'
import { requireControlPlane } from '../../../utils/control-plane'
import { getClientIp } from '../../../utils/client-ip'
import { getEmailBinding } from '../../../utils/cf-env'
import { siteLocaleSchema, siteTimezoneSchema } from '../../../utils/site-fields'

const bodySchema = z.object({
  site: z.object({
    name: z.string().min(1).max(100),
    locale: siteLocaleSchema.default('en'),
    timezone: siteTimezoneSchema.default('UTC'),
  }),
  admin: z.object({
    name: z.string().max(100).optional().default(''),
    email: z.email(),
    password: z.string().max(128).optional().default(''),
  }),
  // No longer asked by the wizard (the provider is picked below); still accepted from older clients.
  email: z.object({
    provider: z.enum(['console', 'cloudflare', 'resend', 'brevo', 'zepto']),
  }).optional(),
  template: z.enum(['landing', 'blog', 'portfolio', 'blank']).default('landing'),
  setupToken: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  try {
    return await _handleSetup(event)
  } catch (e: unknown) {
    // Re-throw H3 errors (createError) as-is; anything else is unexpected, and this is a
    // public, unauthenticated endpoint — log the real error server-side (matching the
    // console.error convention used elsewhere in this codebase, e.g. demo-reset.ts,
    // better-auth.ts) but never leak internal error text (stack details, object names)
    // to an anonymous caller.
    if (isHttpError(e)) throw e
    console.error('[setup/complete] Unexpected error during setup:', e)
    throw httpError({ status: 500, message: 'Setup failed due to an unexpected server error. Please try again.' })
  }
})

async function _handleSetup(event: H3Event) {
  // Never in a member pool, whose database starts empty: the "first install" path below
  // would make whoever got there first its super admin. Its sites come from the control plane.
  requireControlPlane(event)
  // Unauthenticated and now checks an existing account's password (below) — throttle it
  // like the other credential-checking endpoints in 04.auth-override.ts.
  await rateLimit(event, { limit: 10, windowMs: 10 * 60_000, keyPrefix: 'setup-complete' })
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  let host = getHeader(event, 'host')?.split(':')[0] ?? ''
  if (host === '127.0.0.1' || host === '::1') {
    host = 'localhost'
  }

  // Resolve (and, for an existing account, authenticate) the completing admin BEFORE
  // anything below writes — the secondary-site path burns its one-time token, so a
  // rejected password must not be able to consume it.
  const admin = { ...body.admin, email: body.admin.email.toLowerCase() }
  const existingUserId = await authenticateSetupAdmin(db, admin)

  // Initial setup, or a secondary site pre-created by a super admin
  const isInitialSetup = await isInitialInstall(db)
  const siteId = isInitialSetup
    ? await prepareInitialSite(db, host, body.site)
    : await claimSecondarySite(db, host, body.site, body.setupToken)

  // 02.multi-site.ts caches a "no site for this host" null result for 30s per isolate —
  // if anything (a health check, a crawler, even this Worker's own cold-start) resolved
  // this host before setup completed, that stale null would otherwise persist and make
  // every request for up to 30 more seconds — including the admin's own first login —
  // incorrectly bounce off "Unknown site"/the setup guard right after setup just
  // succeeded. Every other route that creates/activates a site already clears this
  // (admin/sites/index.post.ts, [id].patch.ts, site-deletion.ts); this was the one gap.
  clearSiteCache(host)
  clearSetupStatusCache(host)

  // Cloudflare Email when the deployment has the EMAIL binding (the default wrangler.toml
  // does); otherwise nothing is stored, so an env-configured provider still applies and
  // the dashboard checklist asks for one. Changeable any time in Settings → Email.
  await saveSetupSettings(db, siteId, body.email?.provider ?? (getEmailBinding(event) ? 'cloudflare' : null))

  // An existing account was already authenticated against its own password above.
  const adminUserId = existingUserId ?? await createSetupAdminAccount(db, admin)

  if (!isInitialSetup) {
    // The secondary-site path has a real actor to attribute this to (the person completing
    // setup, just resolved above) — unlike the fresh-install path, which has no admin
    // account yet and is deliberately left unlogged. writeAuditLog() scopes to
    // event.context.siteId, which is unset here — /api/v1/setup bypasses 02.multi-site.ts
    // entirely (see that middleware's early-return for setup/auth paths) — so this
    // inserts directly, scoped to the site just completed, mirroring the explicit-siteId
    // pattern admin/sites/index.post.ts uses for the same reason.
    await db.insert(auditLogs).values({
      id: ulid(),
      siteId,
      userId: adminUserId,
      action: 'setup_complete',
      resource: 'site',
      resourceId: siteId,
      after: { domain: host, name: body.site.name },
      ipAddress: getClientIp(event) ?? null,
      userAgent: getHeader(event, 'user-agent') ?? null,
    })
  }

  await seedNewSite(db, { siteId, siteName: body.site.name, authorId: adminUserId, template: body.template })

  // The very first install's owner is the platform operator and gets super_admin.
  // A secondary site is a tenant: its owner gets 'admin' — full control of THIS site
  // only. super_admin is platform-wide (every site, the whole-database export, site
  // suspension), so handing it to whoever completes a tenant's setup link would give
  // every tenant owner control over every other tenant. An existing super admin can
  // still grant it deliberately via POST /api/v1/users/:id/super-admin.
  await grantSetupRole(db, adminUserId, siteId, isInitialSetup ? 'super_admin' : 'admin')

  return created(event, { success: true, siteId })
}
