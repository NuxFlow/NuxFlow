import { ulid } from 'ulid'
import { contentTypes, contentItems, taxonomies, taxonomyContentTypes } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getPrivacyPageContent } from './setup-templates'
import { getBuiltinStarter } from './starters/builtin'
import { createPendingInstall } from './starters/install'

/** A starter site id: one of the built-in ones, or one from the starter catalog. */
export type SiteTemplate = string

/**
 * Everything a brand-new site starts with: the built-in content types, a homepage from the
 * chosen starter site, a privacy page (a welcome post too for the blog starter), and the
 * Categories/Tags taxonomies. Shared by the setup wizard and the hosting platform's
 * automatic sign-up (hosting-billing.ts), so both make the same site.
 */
export async function seedNewSite(db: Db, opts: { siteId: string; siteName: string; authorId: string; template: SiteTemplate }): Promise<void> {
  const { siteId, siteName, authorId, template } = opts
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

  // The homepage (and, for the blog starter, a welcome post) comes from the chosen built-in
  // starter. A catalog starter can't be installed here — its images are copied a few per
  // request by the admin page — so the site starts with the blank one and a pending install
  // that the dashboard offers to finish (starters/install.ts); its pages then replace these.
  const builtin = getBuiltinStarter(template)
  const starter = builtin ?? getBuiltinStarter('blank')!
  const typeIdBySlug: Record<string, string> = { page: pageTypeId, post: postTypeId }
  for (const item of starter.build(siteName).content) {
    const typeId = typeIdBySlug[item.typeSlug]
    if (!typeId) continue
    await db.insert(contentItems).values({
      id: ulid(),
      siteId,
      typeId,
      authorId,
      slug: item.slug,
      title: item.title,
      status: 'published',
      visibility: 'public',
      content: item.content,
      seoTitle: item.seoTitle,
      seoDescription: item.seoDescription,
      publishedAt: new Date().toISOString(),
    })
  }
  if (!builtin) {
    await createPendingInstall(db, { siteId, userId: authorId, starterId: template, mode: 'fresh' })
  }

  // Seeded unconditionally regardless of starter — see getPrivacyPageContent()'s doc
  // comment in setup-templates.ts for why this page needs to exist on every fresh site.
  await db.insert(contentItems).values({
    id: ulid(),
    siteId,
    typeId: pageTypeId,
    authorId: authorId,
    slug: 'privacy',
    title: 'Privacy Policy',
    status: 'published',
    visibility: 'public',
    content: getPrivacyPageContent(),
    seoTitle: `Privacy Policy - ${siteName}`,
    seoDescription: `How ${siteName} collects, uses, and protects your personal data.`,
    publishedAt: new Date().toISOString(),
  })

  // Seed default taxonomies
  // Categories and Tags apply to posts only (taxonomy_content_types); pages opt in
  // from Admin → Taxonomies if a site wants them there too.
  const categoryTaxId = ulid()
  const tagTaxId = ulid()
  await db.insert(taxonomies).values([
    { id: categoryTaxId, siteId, slug: 'category', name: 'Categories', isHierarchical: true },
    { id: tagTaxId, siteId, slug: 'tag', name: 'Tags', isHierarchical: false },
  ])
  await db.insert(taxonomyContentTypes).values([
    { taxonomyId: categoryTaxId, contentTypeId: postTypeId },
    { taxonomyId: tagTaxId, contentTypeId: postTypeId },
  ])

}
