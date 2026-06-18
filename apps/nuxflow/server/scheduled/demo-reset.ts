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
  webhooks,
  rateLimits,
  dynamicPlugins,
  pushSubscriptions,
  aiGenerationJobs,
} from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { hashPassword } from 'better-auth/crypto'

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
  await db.delete(webhooks)
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

  const passwordHash = await hashPassword(DEMO_PASSWORD)
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

  const sp = { top: 80, right: 24, bottom: 80, left: 24, unit: 'px' as const }
  const fp = { top: 64, right: 24, bottom: 64, left: 24, unit: 'px' as const }

  const blocks = [
    {
      id: ulid(),
      type: 'canvas-hero',
      props: {
        headline: 'Fast, modern, and beautiful',
        subtext: 'Welcome to the NuxFlow live demo — an open-source edge CMS built on Nuxt 4 and Cloudflare Workers. Explore the admin, edit pages, and see what NuxFlow can do. Resets nightly at 3 AM UTC.',
        ctaLabel: 'Open admin dashboard',
        ctaUrl: '/admin',
        cta2Label: 'View on GitHub',
        cta2Url: 'https://github.com/NuxFlow/NuxFlow',
        align: 'center',
        bgGradient: 'linear-gradient(to bottom right, #090d16, #064e3b, #022c22, #090d16)',
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
        sectionLabel: 'Why Choose NuxFlow',
        sectionTitle: 'Built for Performance',
        sectionDesc: 'Everything you need to succeed online, managed right from our fast and robust admin dashboard.',
        numFeatures: 3,
        style: 'card',
        align: 'left',
        iconColor: '#00dc82',
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
        headline: 'Ready to explore?',
        subtext: `Log in to the admin dashboard with  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}  and start building. Every change you make is real — and resets nightly.`,
        btnLabel: 'Open Admin Dashboard',
        btnUrl: '/admin',
        bgColor: '#022c22',
        textColor: '#ffffff',
        btnColor: '#00dc82',
        padding: fp,
      },
    },
  ]

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

export const demoReset = async () => {
  const config = useRuntimeConfig()
  if (!config.isDemo) return { skipped: true, reason: 'not a demo instance' }

  const now = new Date()
  if (now.getUTCHours() !== 3 || now.getUTCMinutes() !== 0) {
    return { skipped: true, reason: 'not reset time' }
  }

  const db = useDb()
  await wipeAllTables(db)
  await seedDemo(db)

  return { reset: true, at: now.toISOString() }
}
