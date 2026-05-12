import { z } from 'zod'
import type { H3Event } from 'h3'
import { useDb } from '../../../utils/db'
import { sites, users, accounts, userSiteRoles, contentTypes, contentItems } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { count, eq } from 'drizzle-orm'
import { rateLimit } from '../../../utils/rate-limit'
import { hashPassword } from 'better-auth/crypto'

const bodySchema = z.object({
  site: z.object({
    name: z.string().min(1).max(100),
    domain: z.string().min(1),
    locale: z.string().default('en'),
    timezone: z.string().default('UTC'),
  }),
  admin: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(128),
  }),
  email: z.object({
    provider: z.enum(['console', 'resend', 'brevo', 'zepto', 'smtp']).default('console'),
  }).optional(),
})

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
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'setup' })

  const db = useDb(event)

  // Prevent running setup twice
  const [siteCount] = await db.select({ value: count() }).from(sites)
  if ((siteCount?.value ?? 0) > 0) {
    throw createError({ statusCode: 409, message: 'Setup already completed' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  const siteId = ulid()

  // Create site
  await db.insert(sites).values({
    id: siteId,
    name: body.site.name,
    domain: body.site.domain,
    locale: body.site.locale,
    timezone: body.site.timezone,
    status: 'active',
    setupCompleted: true,
  })

  // Create admin user directly — bypasses Better Auth's HTTP layer which sets
  // response cookies and can conflict when called from within a Nitro handler.
  const adminUserId = ulid()
  const passwordHash = await hashPassword(body.admin.password)

  await db.insert(users).values({
    id: adminUserId,
    name: body.admin.name,
    email: body.admin.email.toLowerCase(),
    emailVerified: false,
  })

  await db.insert(accounts).values({
    id: ulid(),
    accountId: adminUserId,
    providerId: 'credential',
    userId: adminUserId,
    password: passwordHash,
  })

  const adminUser = { id: adminUserId }

  // Seed built-in content types so the editor works out of the box
  const pageTypeId = ulid()
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
      id: ulid(),
      siteId,
      slug: 'post',
      name: 'Posts',
      singularName: 'Post',
      icon: 'i-lucide-pencil',
      isBuiltIn: true,
      hasRevisions: true,
      hasComments: true,
    },
  ])

  // Insert the homepage row synchronously with no content; heavy Canvas
  // seeding runs after the response via ctx.waitUntil.
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
    content: null,
    seoTitle: siteName,
    seoDescription: `Welcome to ${siteName}`,
    publishedAt: new Date().toISOString(),
  })

  async function seedCanvasContent() {
    const sp = { top: 80, right: 24, bottom: 80, left: 24, unit: 'px' as const }
    const fp = { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const }
    await db.update(contentItems)
      .set({
        content: {
          type: 'canvas',
          blocks: [
            {
              id: ulid(),
              type: 'canvas-hero',
              props: {
                headline: 'The CMS built for the edge',
                subtext: `${siteName} is powered by NuxFlow — an open-source CMS built on Nuxt 4 and Cloudflare Workers. Fast, flexible, and fully self-hosted.`,
                ctaLabel: 'Go to dashboard',
                ctaUrl: '/admin',
                cta2Label: 'View on GitHub',
                cta2Url: 'https://github.com/mattmacmillan76/Nuxflow',
                align: 'center',
                bgGradient: 'linear-gradient(to bottom right, #030712, #111827, #030712)',
                textColor: '#ffffff',
                ctaBgColor: '#00dc82',
                logoIcon: 'i-lucide-layers',
                showDecorations: true,
                padding: sp,
              },
            },
            {
              id: ulid(),
              type: 'canvas-features',
              props: {
                sectionLabel: 'Everything you need',
                sectionTitle: 'Built for real projects',
                sectionDesc: 'From a simple blog to a multi-site platform with payments and visual page building — NuxFlow handles it all from a single deployment.',
                numFeatures: 3,
                style: 'card',
                align: 'left',
                iconColor: '#00dc82',
                feat1Icon: 'i-lucide-zap',
                feat1Title: 'Edge-first performance',
                feat1Desc: 'Runs on Cloudflare Workers at the edge — zero cold starts, global by default, no server to manage.',
                feat2Icon: 'i-lucide-layout-panel-top',
                feat2Title: 'Canvas page builder',
                feat2Desc: 'Drag-and-drop visual editor with hero sections, feature grids, testimonials, and more — no code required.',
                feat3Icon: 'i-lucide-puzzle',
                feat3Title: 'Hot-loading plugins & themes',
                feat3Desc: 'Install plugins and upload CSS themes without redeploying. Dynamic plugins run as isolated Cloudflare Workers.',
                gap: 20,
                padding: { top: 64, right: 24, bottom: 16, left: 24, unit: 'px' as const },
              },
            },
            {
              id: ulid(),
              type: 'canvas-features',
              props: {
                numFeatures: 3,
                style: 'card',
                align: 'left',
                iconColor: '#00dc82',
                feat1Icon: 'i-lucide-sparkles',
                feat1Title: 'AI writing assistant',
                feat1Desc: 'Improve your writing, generate SEO metadata, and produce image alt text with built-in AI tools.',
                feat2Icon: 'i-lucide-globe',
                feat2Title: 'Multi-site ready',
                feat2Desc: 'Manage multiple websites from a single deployment — each with its own content, users, and settings.',
                feat3Icon: 'i-lucide-credit-card',
                feat3Title: 'Payments & memberships',
                feat3Desc: 'Accept subscriptions via Stripe, Lemon Squeezy, or Paddle and gate content behind membership tiers.',
                gap: 20,
                padding: { top: 16, right: 24, bottom: 64, left: 24, unit: 'px' as const },
              },
            },
            {
              id: ulid(),
              type: 'canvas-cta',
              props: {
                headline: 'Ready to build?',
                subtext: 'Your site is live. Head to the dashboard to create content, manage media, and configure your plugins.',
                btnLabel: 'Open dashboard',
                btnUrl: '/admin',
                bgColor: '#00dc82',
                textColor: '#0f172a',
                btnColor: '#0f172a',
                padding: fp,
              },
            },
          ],
        },
      })
      .where(eq(contentItems.id, homepageId))
  }

  const cfCtx = event.context.cloudflare?.ctx
  if (cfCtx) {
    cfCtx.waitUntil(seedCanvasContent())
  } else {
    await seedCanvasContent()
  }

  // Grant super_admin role
  await db.insert(userSiteRoles).values({
    id: ulid(),
    userId: adminUser.id,
    siteId,
    role: 'super_admin',
  })

  setResponseStatus(event, 201)
  return { success: true, siteId }
}
