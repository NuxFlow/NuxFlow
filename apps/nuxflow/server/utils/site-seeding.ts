import { ulid } from 'ulid'
import { contentTypes, contentItems, taxonomies, taxonomyContentTypes } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getTemplateBlocks, getHelloWorldPostContent, getPrivacyPageContent } from './setup-templates'

export type SiteTemplate = 'landing' | 'blog' | 'portfolio' | 'blank'

/**
 * Everything a brand-new site starts with: the built-in content types, a homepage from the
 * chosen template, a privacy page (a welcome post too for the blog template), and the
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

  const blocks = getTemplateBlocks(template, siteName)

  // Insert the homepage row synchronously with populated Canvas content blocks
  const homepageId = ulid()
  await db.insert(contentItems).values({
    id: homepageId,
    siteId,
    typeId: pageTypeId,
    authorId: authorId,
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
  if (template === 'blog') {
    await db.insert(contentItems).values({
      id: ulid(),
      siteId,
      typeId: postTypeId,
      authorId: authorId,
      slug: 'hello-world',
      title: 'Hello World!',
      status: 'published',
      visibility: 'public',
      content: getHelloWorldPostContent(),
      seoTitle: 'Hello World! - Welcome to NuxFlow',
      seoDescription: 'This is the first seeded post on your new edge-native blog.',
      publishedAt: new Date().toISOString(),
    })
  }

  // Seeded unconditionally regardless of template — see getPrivacyPageContent()'s doc
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
