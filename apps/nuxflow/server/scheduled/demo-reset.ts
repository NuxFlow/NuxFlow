import { useDb } from '../utils/db'
import {
  sites,
  siteSettings,
  users,
  accounts,
  sessions,
  verifications,
  userSiteRoles,
  apiKeys,
  passkeys,
  contentTypes,
  contentItems,
  contentRevisions,
  taxonomies,
  taxonomyTerms,
  contentTaxonomyTerms,
  menus,
  redirects,
  comments,
  media,
  mediaFolders,
  videoAssets,
  forms,
  formSubmissions,
  membershipTiers,
  subscriptions,
  themes,
  auditLogs,
  notifications,
  rateLimits,
  dynamicPlugins,
  pushSubscriptions,
  aiGenerationJobs,
} from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { nuxflowPasswordHasher } from '../utils/pw'
import { getTemplateBlocks } from '../utils/setup-templates'

const DEMO_EMAIL = 'demo@nuxflow.dev'
const DEMO_PASSWORD = 'demo123'
const DEMO_NAME = 'NuxFlow Demo'
const DEMO_DOMAIN = 'demo.nuxflow.dev'

type Db = ReturnType<typeof useDb>

async function wipeAllTables(db: Db) {
  // Delete in dependency order — deepest dependents first so FK constraints are respected
  await db.delete(contentTaxonomyTerms)
  await db.delete(taxonomyTerms)
  await db.delete(contentRevisions)
  await db.delete(comments)
  await db.delete(formSubmissions)
  await db.delete(subscriptions)
  await db.delete(aiGenerationJobs)
  await db.delete(pushSubscriptions)
  await db.delete(notifications)
  await db.delete(auditLogs)
  await db.delete(contentItems)
  await db.delete(contentTypes)
  await db.delete(taxonomies)
  await db.delete(menus)
  await db.delete(redirects)
  await db.delete(forms)
  await db.delete(membershipTiers)
  await db.delete(media)
  await db.delete(mediaFolders)
  await db.delete(videoAssets)
  await db.delete(themes)
  await db.delete(dynamicPlugins)
  await db.delete(rateLimits)
  await db.delete(siteSettings)
  await db.delete(apiKeys)
  await db.delete(userSiteRoles)
  await db.delete(passkeys)
  await db.delete(sessions)
  await db.delete(verifications)
  await db.delete(accounts)
  await db.delete(sites)
  await db.delete(users)
}

async function seedDemo(db: Db) {
  const siteId = ulid()
  const userId = ulid()
  const pageTypeId = ulid()
  const postTypeId = ulid()

  await db.insert(sites).values({
    id: siteId,
    name: DEMO_NAME,
    domain: DEMO_DOMAIN,
    locale: 'en',
    timezone: 'UTC',
    status: 'active',
    setupCompleted: true,
  })

  await db.insert(siteSettings).values([
    { id: ulid(), siteId, key: 'email.provider', value: 'console' },
    { id: ulid(), siteId, key: 'frontend.show_header', value: false },
  ])

  const passwordHash = await nuxflowPasswordHasher.hash(DEMO_PASSWORD)
  await db.insert(users).values({
    id: userId,
    name: 'Demo Admin',
    email: DEMO_EMAIL,
    emailVerified: true,
  })
  await db.insert(accounts).values({
    id: ulid(),
    accountId: userId,
    providerId: 'credential',
    // Must match Better Auth's own createLocalAccountIssuer('credential') —
    // sign-in looks accounts up by (issuer, accountId), not providerId.
    issuer: 'local:credential',
    userId,
    password: passwordHash,
  })

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
  ])

  // Reuse the shared 'landing' template (same hero/features/cta shape, icons, gradient,
  // and colors that server/api/v1/setup/complete.post.ts seeds for a real site) and only
  // override the copy that's genuinely demo-specific: the hero's pitch/CTA label, the
  // features section's label, and the closing CTA's headline/subtext (which points
  // visitors at the shared demo login and mentions the nightly reset).
  type CanvasBlock = { id: string; type: string; props: Record<string, unknown> }
  const templateBlocks = getTemplateBlocks('landing', DEMO_NAME) as CanvasBlock[]

  const blocks = templateBlocks.map((block): CanvasBlock => {
    if (block.type === 'canvas-hero') {
      return {
        ...block,
        props: {
          ...block.props,
          subtext: 'Welcome to the NuxFlow live demo — an open-source edge CMS built on Nuxt 4 and Cloudflare Workers. Explore the admin, edit pages, and see what NuxFlow can do. Resets nightly at 3 AM UTC.',
          ctaLabel: 'Open admin dashboard',
        },
      }
    }
    if (block.type === 'canvas-features') {
      return {
        ...block,
        props: {
          ...block.props,
          sectionLabel: 'Why Choose NuxFlow',
        },
      }
    }
    if (block.type === 'canvas-cta') {
      return {
        ...block,
        props: {
          ...block.props,
          headline: 'Ready to explore?',
          subtext: `Log in to the admin dashboard with  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}  and start building. Every change you make is real — and resets nightly.`,
        },
      }
    }
    return block
  })

  await db.insert(contentItems).values({
    id: ulid(),
    siteId,
    typeId: pageTypeId,
    authorId: userId,
    slug: 'home',
    title: DEMO_NAME,
    status: 'published',
    visibility: 'public',
    content: { type: 'canvas', blocks },
    seoTitle: 'NuxFlow Demo — Edge-native CMS on Nuxt 4 + Cloudflare',
    seoDescription: 'Live demo of NuxFlow, the open-source visual CMS built on Nuxt 4 and Cloudflare Workers. Resets nightly.',
    publishedAt: new Date().toISOString(),
  })

  await db.insert(contentItems).values({
    id: ulid(),
    siteId,
    typeId: postTypeId,
    authorId: userId,
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
              text: 'Welcome to the NuxFlow demo blog. This is a seeded example post. You can edit, create, or delete posts from the admin dashboard. Explore the rich text editor, manage media, and see what NuxFlow can do. This entire site resets nightly at 3 AM UTC.',
            },
          ],
        },
      ],
    },
    seoTitle: 'Hello World! — NuxFlow Demo',
    seoDescription: 'An example blog post seeded in the NuxFlow live demo.',
    publishedAt: new Date().toISOString(),
  })

  await db.insert(taxonomies).values([
    { id: ulid(), siteId, slug: 'category', name: 'Categories', isHierarchical: true },
    { id: ulid(), siteId, slug: 'post_tag', name: 'Tags', isHierarchical: false },
  ])

  await db.insert(userSiteRoles).values({
    id: ulid(),
    userId,
    siteId,
    role: 'super_admin',
  })
}

// useRuntimeConfig().isDemo is always false in CF module workers because [vars] from
// wrangler.demo.toml are not in process.env — they live in the `env` binding object.
// Nitro sets globalThis.__env__ = env before running scheduled tasks, so we check that.
function isDemoInstance(): boolean {
  return useRuntimeConfig().isDemo === true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    || (globalThis as any).__env__?.NUXT_IS_DEMO === 'true'
}

// Runs on every * * * * * tick — seeds the DB on first boot only, then does nothing.
export const demoFirstBoot = async () => {
  if (!isDemoInstance()) return { skipped: true, reason: 'not a demo instance' }

  try {
    const db = useDb()
    const [existing] = await db.select({ id: sites.id }).from(sites).limit(1)
    if (existing) return { skipped: true, reason: 'already seeded' }

    await seedDemo(db)
    return { seeded: true, reason: 'first boot' }
  }
  catch (err) {
    console.error('[demo-reset] demoFirstBoot failed:', err)
    throw err
  }
}

// Runs on the dedicated 0 3 * * * cron — wipes and reseeds the demo data.
// No internal time check: the cron schedule itself controls when this fires.
export const demoNightlyReset = async () => {
  if (!isDemoInstance()) return { skipped: true, reason: 'not a demo instance' }

  const db = useDb()
  const now = new Date()

  await wipeAllTables(db)

  try {
    await seedDemo(db)
  }
  catch (err) {
    console.error('[demo-reset] seedDemo failed after wipe:', err)
    throw err
  }

  return { reset: true, at: now.toISOString() }
}
