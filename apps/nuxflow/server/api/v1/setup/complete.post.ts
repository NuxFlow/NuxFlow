import { z } from 'zod'
import type { H3Event } from 'h3'
import { useDb } from '../../../utils/db'
import { sites, users, accounts, userSiteRoles, contentTypes, contentItems, taxonomies, siteSettings } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { count, eq, and } from 'drizzle-orm'
import { nuxflowPasswordHasher } from '../../../utils/pw'

const bodySchema = z.object({
  site: z.object({
    name: z.string().min(1).max(100),
    locale: z.string().default('en'),
    timezone: z.string().default('UTC'),
  }),
  admin: z.object({
    name: z.string().max(100).optional().default(''),
    email: z.string().email(),
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
    // Re-throw H3 errors (createError) as-is; wrap everything else so the actual
    // message is visible in the browser console during debugging.
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    throw createError({ statusCode: 500, message: msg })
  }
})

async function _handleSetup(event: H3Event) {
  const db = useDb(event)
  const body = await readValidatedBody(event, bodySchema.parse)

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
      throw createError({ statusCode: 404, message: `Site for domain ${host} not found.` })
    }

    if (site.setupCompleted) {
      throw createError({ statusCode: 409, message: 'Setup already completed for this site.' })
    }

    // Secondary sites can only be claimed with the one-time token issued when the super
    // admin created the site record — completing setup grants super_admin, so this must
    // never be reachable by an unauthenticated request that merely knows the domain.
    if (!site.setupTokenHash) {
      throw createError({ statusCode: 403, message: 'This site has no setup link. Ask a super admin to generate one.' })
    }
    if (!body.setupToken || (await hashSetupToken(body.setupToken)) !== site.setupTokenHash) {
      throw createError({ statusCode: 403, message: 'Invalid or missing setup token.' })
    }

    siteId = site.id
    // Update the site details with anything the user might have updated in the wizard, and
    // burn the setup token so it cannot be replayed.
    await db.update(sites)
      .set({
        name: body.site.name,
        locale: body.site.locale,
        timezone: body.site.timezone,
        setupCompleted: true,
        setupTokenHash: null,
      })
      .where(eq(sites.id, siteId))
  }

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
      throw createError({ statusCode: 400, message: 'A name and password of at least 8 characters are required for new accounts.' })
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
      userId: adminUserId,
      password: passwordHash,
    })
  }

  const adminUser = { id: adminUserId }

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

  const sp = { top: 80, right: 24, bottom: 80, left: 24, unit: 'px' as const }
  const fp = { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const }

  let blocks: Record<string, unknown>[]

  if (body.template === 'landing') {
    blocks = [
      {
        id: ulid(),
        type: 'canvas-hero',
        props: {
          headline: 'Fast, modern, and beautiful',
          subtext: `Welcome to ${body.site.name}. We are powered by NuxFlow — the open-source visual CMS optimized for the Cloudflare edge ecosystem.`,
          ctaLabel: 'Go to dashboard',
          ctaUrl: '/admin',
          cta2Label: 'View on GitHub',
          cta2Url: 'https://github.com/NuxFlow/NuxFlow',
          align: 'center',
          bgGradient: 'linear-gradient(to bottom right, #090d16, #064e3b, #022c22, #090d16)',
          textColor: '#ffffff',
          ctaBgColor: 'var(--nuxflow-primary, #00dc82)',
          logoIcon: 'i-lucide-layers',
          showDecorations: true,
          padding: sp,
        },
      },
      {
        id: ulid(),
        type: 'canvas-features',
        props: {
          sectionLabel: 'Why Choose Us',
          sectionTitle: 'Built for Performance',
          sectionDesc: 'Everything you need to succeed online, managed right from our fast and robust admin dashboard.',
          numFeatures: 3,
          style: 'card',
          align: 'left',
          iconColor: 'var(--nuxflow-primary, #00dc82)',
          feat1Icon: 'i-lucide-zap',
          feat1Title: 'Edge Performance',
          feat1Desc: 'Global distribution with absolute speed. Zero cold starts, running closer to your audience.',
          feat2Icon: 'i-lucide-layout',
          feat2Title: 'Visual Canvas Builder',
          feat2Desc: 'Custom page layouts in seconds. Add, edit, or rearrange sections with no technical experience needed.',
          feat3Icon: 'i-lucide-shield',
          feat3Title: 'Ultimate Security',
          feat3Desc: 'Highly secure edge shielding, sandboxed plugin execution, and robust isolation by default.',
          gap: 24,
          padding: { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const },
        },
      },
      {
        id: ulid(),
        type: 'canvas-cta',
        props: {
          headline: 'Ready to grow?',
          subtext: 'Your workspace is set up and ready to create. Start building your client and portal pages today!',
          btnLabel: 'Open Admin Dashboard',
          btnUrl: '/admin',
          bgColor: '#022c22',
          textColor: '#ffffff',
          btnColor: 'var(--nuxflow-primary, #00dc82)',
          padding: fp,
        },
      },
    ]
  } else if (body.template === 'blog') {
    blocks = [
      {
        id: ulid(),
        type: 'canvas-hero',
        props: {
          headline: 'Welcome to Our Journal',
          subtext: `Thoughts, ideas, and stories on the latest edge-native technology and publishing trends. Brought to you by ${body.site.name}.`,
          ctaLabel: 'Read Blog Posts',
          ctaUrl: '/admin/content?type=post',
          align: 'center',
          bgGradient: 'linear-gradient(to bottom right, #022c22, #047857, #022c22)',
          textColor: '#ffffff',
          ctaBgColor: 'var(--nuxflow-primary, #10b981)',
          logoIcon: 'i-lucide-book-open',
          showDecorations: true,
          padding: sp,
        },
      },
      {
        id: ulid(),
        type: 'canvas-text',
        props: {
          content: `
            <h2 style="font-size: 1.75rem; font-weight: 800; margin-bottom: 1rem; color: #111827;">Publishing on the Serverless Edge</h2>
            <p style="font-size: 1.05rem; line-height: 1.7; color: #374151; margin-bottom: 1rem;">
              This blog template is pre-seeded with NuxFlow. Everything here is running natively on Cloudflare Workers and D1, making it extremely secure, globally distributed, and blisteringly fast.
            </p>
            <p style="font-size: 1.05rem; line-height: 1.7; color: #374151;">
              To customize your homepage or write new articles, head to the admin panel. Your seeded post <strong>"Hello World!"</strong> is already live and editable in the Posts directory index.
            </p>
          `,
          padding: { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const },
        },
      },
      {
        id: ulid(),
        type: 'canvas-cta',
        props: {
          headline: 'Share your stories',
          subtext: 'Ready to write your own articles? Log into your dashboard and publish your first post today.',
          btnLabel: 'Write a Post',
          btnUrl: '/admin/content?type=post',
          bgColor: '#022c22',
          textColor: '#ffffff',
          btnColor: 'var(--nuxflow-primary, #10b981)',
          padding: fp,
        },
      },
    ]
  } else if (body.template === 'portfolio') {
    blocks = [
      {
        id: ulid(),
        type: 'canvas-hero',
        props: {
          headline: 'Building Digital Experiences',
          subtext: `Hi! I am a creator and developer. This is my professional portfolio showcase where I share my creative web apps and designs. Powered by ${body.site.name}.`,
          ctaLabel: 'View Projects',
          ctaUrl: '/admin',
          align: 'left',
          bgGradient: 'linear-gradient(to bottom right, #0f0728, #3b0764, #0f0728)',
          textColor: '#ffffff',
          ctaBgColor: 'var(--nuxflow-primary, #d946ef)',
          logoIcon: 'i-lucide-palette',
          showDecorations: true,
          padding: sp,
        },
      },
      {
        id: ulid(),
        type: 'canvas-features',
        props: {
          sectionLabel: 'Selected Projects',
          sectionTitle: 'My Work & Showcase',
          sectionDesc: 'Take a look at some of my recent digital works, UI designs, and web applications.',
          numFeatures: 3,
          style: 'card',
          align: 'left',
          iconColor: 'var(--nuxflow-primary, #d946ef)',
          feat1Icon: 'i-lucide-globe',
          feat1Title: 'Web App Design',
          feat1Desc: 'Interactive client web applications built using Nuxt 4, Vue 3, and rich micro-animations.',
          feat2Icon: 'i-lucide-smartphone',
          feat2Title: 'Mobile Interfaces',
          feat2Desc: 'Pixel-perfect mobile viewports and native layout optimizations for handheld screens.',
          feat3Icon: 'i-lucide-sparkles',
          feat3Title: 'Visual Page Canvas',
          feat3Desc: 'Bespoke components designed to allow instant visual updates via Canvas editors.',
          gap: 24,
          padding: { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const },
        },
      },
      {
        id: ulid(),
        type: 'canvas-cta',
        props: {
          headline: 'Work with me',
          subtext: 'I am always open to discussing new opportunities, custom web designs, or client applications.',
          btnLabel: 'Get in Touch',
          btnUrl: '/admin',
          bgColor: '#0f0728',
          textColor: '#ffffff',
          btnColor: 'var(--nuxflow-primary, #d946ef)',
          padding: fp,
        },
      },
    ]
  } else {
    // blank template
    blocks = [
      {
        id: ulid(),
        type: 'canvas-text',
        props: {
          content: `
            <h1 style="font-size: 2.5rem; font-weight: 800; text-align: center; margin-top: 4rem; margin-bottom: 1rem; color: #111827;">Welcome to your blank canvas</h1>
            <p style="text-align: center; color: #4b5563; max-width: 600px; margin: 0 auto; line-height: 1.6; font-size: 1.1rem;">
              Your site is set up cleanly with NuxFlow. Double-click here to start editing this section or add more Canvas blocks from the toolbar below.
            </p>
          `,
          padding: { top: 80, right: 24, bottom: 80, left: 24, unit: 'px' as const },
        },
      },
    ]
  }

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

  setResponseStatus(event, 201)
  return { success: true, siteId }
}
