import { z } from 'zod'
import type { H3Event } from 'h3'
import { useDb } from '../../../utils/db'
import { sites, users, accounts, userSiteRoles, contentTypes, contentItems, taxonomies, siteSettings, auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { count, eq, and } from 'drizzle-orm'
import { nuxflowPasswordHasher } from '../../../utils/pw'
import { created } from '../../../utils/response'
import { isHttpError } from '../../../utils/errors'
import { clearSiteCache } from '../../../middleware/02.multi-site'
import { clearSetupStatusCache } from './status.get'
import { getTemplateBlocks } from '../../../utils/setup-templates'

const bodySchema = z.object({
  site: z.object({
    name: z.string().min(1).max(100),
    locale: z.string().default('en'),
    timezone: z.string().default('UTC'),
  }),
  admin: z.object({
    name: z.string().max(100).optional().default(''),
    email: z.email(),
    password: z.string().max(128).optional().default(''),
  }),
  email: z.object({
    provider: z.enum(['console', 'cloudflare', 'resend', 'brevo', 'zepto', 'smtp']).default('console'),
  }).optional(),
  template: z.enum(['landing', 'blog', 'portfolio', 'blank']).default('landing'),
  setupToken: z.string().optional(),
})

async function hashSetupToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

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
    throw createError({ statusCode: 500, message: 'Setup failed due to an unexpected server error. Please try again.' })
  }
})

async function _handleSetup(event: H3Event) {
  const db = useDb(event)
  const body = await parseBody(event, bodySchema)

  let host = getHeader(event, 'host')?.split(':')[0] ?? ''
  if (host === '127.0.0.1' || host === '::1') {
    host = 'localhost'
  }

  // Check if we are running initial setup or setting up a pre-created secondary site
  const [siteCount] = await db.select({ value: count() }).from(sites)
  const [userCount] = await db.select({ value: count() }).from(users)
  const isInitialSetup = (siteCount?.value ?? 0) === 0 || (userCount?.value ?? 0) === 0

  let siteId: string

  if (isInitialSetup) {
    const existingSite = await db.query.sites.findFirst({
      where: eq(sites.domain, host),
    })

    if (existingSite) {
      siteId = existingSite.id
      // Clear any stale seeded data associated with this site to avoid duplicates/integrity errors
      // Delete child/referencing tables first to respect foreign key constraints
      await db.delete(contentItems).where(eq(contentItems.siteId, siteId))
      await db.delete(contentTypes).where(eq(contentTypes.siteId, siteId))
      await db.delete(taxonomies).where(eq(taxonomies.siteId, siteId))
      await db.delete(siteSettings).where(eq(siteSettings.siteId, siteId))
      await db.delete(userSiteRoles).where(eq(userSiteRoles.siteId, siteId))

      await db.update(sites)
        .set({
          name: body.site.name,
          locale: body.site.locale,
          timezone: body.site.timezone,
          status: 'active',
          setupCompleted: true,
        })
        .where(eq(sites.id, siteId))
    } else {
      siteId = ulid()
      await db.insert(sites).values({
        id: siteId,
        name: body.site.name,
        domain: host,
        locale: body.site.locale,
        timezone: body.site.timezone,
        status: 'active',
        setupCompleted: true,
      })
    }
  } else {
    // Pre-created secondary site — find by the request host (the domain was set when super
    // admin created the site record, not from the setup form).
    const site = await db.query.sites.findFirst({
      where: eq(sites.domain, host),
    })

    if (!site) {
      throw notFound(`Site for domain ${host} not found.`)
    }

    if (site.setupCompleted) {
      throw conflict('Setup already completed for this site.')
    }

    // Secondary sites can only be claimed with the one-time token issued when the super
    // admin created the site record — completing setup grants super_admin, so this must
    // never be reachable by an unauthenticated request that merely knows the domain.
    if (!site.setupTokenHash) {
      throw forbidden('This site has no setup link. Ask a super admin to generate one.')
    }
    if (!body.setupToken) {
      throw forbidden('Invalid or missing setup token.')
    }

    siteId = site.id
    const providedTokenHash = await hashSetupToken(body.setupToken)

    // Claim the token and burn it in one atomic, conditional statement — the WHERE clause
    // re-checks setupTokenHash against the *current* row, not the value read a moment ago.
    // Two concurrent requests both carrying a valid (e.g. leaked/observed) token would
    // otherwise both pass the earlier read-based check and both proceed to seed content
    // and grant super_admin, before either write landed. D1 serialises this single UPDATE,
    // so only one request's WHERE clause can match — `.returning()` (portable across the
    // D1 and libSQL/better-sqlite3 drivers, unlike D1's own `.meta.changes`) comes back
    // empty for the request that lost the race, which is rejected exactly like a token
    // that was already burned.
    const claimed = await db.update(sites)
      .set({
        name: body.site.name,
        locale: body.site.locale,
        timezone: body.site.timezone,
        setupCompleted: true,
        setupTokenHash: null,
      })
      .where(and(eq(sites.id, siteId), eq(sites.setupTokenHash, providedTokenHash)))
      .returning({ id: sites.id })

    if (claimed.length === 0) {
      throw forbidden('Invalid or missing setup token.')
    }
  }

  // 02.multi-site.ts caches a "no site for this host" null result for 30s per isolate —
  // if anything (a health check, a crawler, even this Worker's own cold-start) resolved
  // this host before setup completed, that stale null would otherwise persist and make
  // every request for up to 30 more seconds — including the admin's own first login —
  // incorrectly bounce off "Unknown site"/the setup guard right after setup just
  // succeeded. Every other route that creates/activates a site already clears this
  // (admin/sites/index.post.ts, [id].patch.ts, site-deletion.ts); this was the one gap.
  clearSiteCache(host)
  clearSetupStatusCache(host)

  // Seed initial site settings from setup choices
  await db.insert(siteSettings).values([
    {
      id: ulid(),
      siteId,
      key: 'email.provider',
      value: body.email?.provider ?? 'console',
    },
    {
      id: ulid(),
      siteId,
      key: 'frontend.show_header',
      value: false,
    },
  ])

  let adminUserId: string

  // Check if the user email already exists globally
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, body.admin.email.toLowerCase()),
  })

  if (existingUser) {
    adminUserId = existingUser.id
    // If they exist, we don't need to re-insert. We just reuse the existing user.
  } else {
    // If creating a new user, name and password are required.
    if (!body.admin.name || !body.admin.password || body.admin.password.length < 8) {
      throw badRequest('A name and password of at least 8 characters are required for new accounts.')
    }

    // Create admin user directly
    adminUserId = ulid()
    const passwordHash = await nuxflowPasswordHasher.hash(body.admin.password)

    await db.insert(users).values({
      id: adminUserId,
      name: body.admin.name,
      email: body.admin.email.toLowerCase(),
      emailVerified: true,
    })

    await db.insert(accounts).values({
      id: ulid(),
      accountId: adminUserId,
      providerId: 'credential',
      // Must match Better Auth's own createLocalAccountIssuer('credential') —
      // sign-in looks accounts up by (issuer, accountId), not providerId.
      issuer: 'local:credential',
      userId: adminUserId,
      password: passwordHash,
    })
  }

  const adminUser = { id: adminUserId }

  if (!isInitialSetup) {
    // The secondary-site path has a real actor to attribute this to (the person completing
    // setup, just resolved above as adminUser.id) — unlike the fresh-install path, which
    // has no admin account yet and is deliberately left unlogged. writeAuditLog() scopes
    // to event.context.siteId, which is unset here — /api/v1/setup bypasses
    // 02.multi-site.ts entirely (see that middleware's early-return for setup/auth
    // paths) — so this inserts directly, scoped to the site just completed, mirroring the
    // explicit-siteId pattern admin/sites/index.post.ts uses for the same reason.
    await db.insert(auditLogs).values({
      id: ulid(),
      siteId,
      userId: adminUser.id,
      action: 'setup_complete',
      resource: 'site',
      resourceId: siteId,
      after: { domain: host, name: body.site.name },
      ipAddress: getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? null,
      userAgent: getHeader(event, 'user-agent') ?? null,
    })
  }

  // Seed built-in content types so the editor works out of the box
  const pageTypeId = ulid()
  const postTypeId = ulid()
  await db.insert(contentTypes).values([
    {
      id: pageTypeId,
      siteId,
      slug: 'page',
      name: 'Pages',
      singularName: 'Page',
      icon: 'i-lucide-file-text',
      isBuiltIn: true,
      hasRevisions: true,
      hasComments: false,
    },
    {
      id: postTypeId,
      siteId,
      slug: 'post',
      name: 'Posts',
      singularName: 'Post',
      icon: 'i-lucide-pencil',
      isBuiltIn: true,
      hasRevisions: true,
      hasComments: true,
    },
    {
      id: ulid(),
      siteId,
      slug: 'event',
      name: 'Events',
      singularName: 'Event',
      icon: 'i-lucide-calendar',
      isBuiltIn: true,
      hasRevisions: true,
      hasComments: true,
    },
  ])

  const blocks = getTemplateBlocks(body.template, body.site.name)

  // Insert the homepage row synchronously with populated Canvas content blocks
  const homepageId = ulid()
  const siteName = body.site.name
  await db.insert(contentItems).values({
    id: homepageId,
    siteId,
    typeId: pageTypeId,
    authorId: adminUser.id,
    slug: 'home',
    title: siteName,
    status: 'published',
    visibility: 'public',
    content: {
      type: 'canvas',
      blocks,
    },
    seoTitle: siteName,
    seoDescription: `Welcome to ${siteName}`,
    publishedAt: new Date().toISOString(),
  })

  // If the user selected the Blog template, seed a welcome post as well
  if (body.template === 'blog') {
    await db.insert(contentItems).values({
      id: ulid(),
      siteId,
      typeId: postTypeId,
      authorId: adminUser.id,
      slug: 'hello-world',
      title: 'Hello World!',
      status: 'published',
      visibility: 'public',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Welcome to your brand new NuxFlow blog. This is your very first post! You can edit, replace, or delete this post anytime from your admin panel. Head over to the dashboard to start writing new journals, creating media assets, and building custom page flows.',
              }
            ]
          }
        ]
      },
      seoTitle: 'Hello World! - Welcome to NuxFlow',
      seoDescription: 'This is the first seeded post on your new edge-native blog.',
      publishedAt: new Date().toISOString(),
    })
  }

  // Both the global cookie-consent banner and the canvas GDPR block link to /privacy
  // by default (see apps/nuxflow/app/components/public/CookieConsent.vue and
  // packages/canvas/src/blocks/CanvasBlockGdpr.vue) — without this, that link 404s on
  // every fresh site until an admin happens to create the page themselves. Seeded as
  // ordinary, fully editable page content (not locked or hidden from the content list)
  // since this boilerplate text is a starting point, not real legal advice — the admin
  // is expected to review and customize it for their own data practices.
  await db.insert(contentItems).values({
    id: ulid(),
    siteId,
    typeId: pageTypeId,
    authorId: adminUser.id,
    slug: 'privacy',
    title: 'Privacy Policy',
    status: 'published',
    visibility: 'public',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: 'This is placeholder text — replace it with your own privacy policy before launch. Describe what personal data you collect, why, how long you keep it, which third parties (analytics, payment processors, email providers) you share it with, and how a visitor can exercise their rights (access, correction, deletion) over their data.',
          }],
        },
      ],
    },
    seoTitle: `Privacy Policy - ${siteName}`,
    seoDescription: `How ${siteName} collects, uses, and protects your personal data.`,
    publishedAt: new Date().toISOString(),
  })

  // Seed default taxonomies
  await db.insert(taxonomies).values([
    { id: ulid(), siteId, slug: 'category', name: 'Categories', isHierarchical: true },
    { id: ulid(), siteId, slug: 'post_tag', name: 'Tags', isHierarchical: false },
  ])

  // Grant super_admin role on this specific site if they don't already have one
  const existingRole = await db.query.userSiteRoles.findFirst({
    where: and(
      eq(userSiteRoles.userId, adminUser.id),
      eq(userSiteRoles.siteId, siteId)
    ),
  })

  if (!existingRole) {
    await db.insert(userSiteRoles).values({
      id: ulid(),
      userId: adminUser.id,
      siteId,
      role: 'super_admin',
    })
  }

  return created(event, { success: true, siteId })
}
