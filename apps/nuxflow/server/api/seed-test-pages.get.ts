import { useDb } from '../utils/db'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { requireSuperAdmin } from '../utils/permissions'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV !== 'development') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  await requireSuperAdmin(event)

  const db = useDb(event)

  // 1. Get the first active site
  const site = await db.query.sites.findFirst()
  if (!site) {
    throw createError({ statusCode: 404, message: 'No sites found. Please complete site setup first.' })
  }

  // 2. Get the first user (author/admin)
  const user = await db.query.users.findFirst()
  if (!user) {
    throw createError({ statusCode: 404, message: 'No users found. Please complete site setup first.' })
  }

  // 3. Get the "page" content type
  const pageType = await db.query.contentTypes.findFirst({
    where: eq(contentTypes.slug, 'page')
  })
  if (!pageType) {
    throw createError({ statusCode: 404, message: 'Page content type not found.' })
  }

  // 4. Define the 4 custom test pages
  const testPages = [
    {
      slug: 'test-formatting',
      title: 'Test Page - Rich Typography Formatting',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Heading 1: Text Typography Showcase' }]
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This is a standard paragraph showing off multiple text formats: ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'bold text' },
              { type: 'text', text: ', ' },
              { type: 'text', marks: [{ type: 'italic' }], text: 'italicized text' },
              { type: 'text', text: ', ' },
              { type: 'text', marks: [{ type: 'strike' }], text: 'strikethrough text' },
              { type: 'text', text: ', and ' },
              { type: 'text', marks: [{ type: 'code' }], text: 'inline code snippets' },
              { type: 'text', text: '.' }
            ]
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Heading 2: Blockquotes & Separators' }]
          },
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'NuxFlow is designed from the ground up for serverless edge scaling. This blockquote represents a beautiful, styled callout for quotes or highlighted info.' }]
              }
            ]
          },
          { type: 'horizontalRule' },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Heading 3: List Variants' }]
          },
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First bullet item in our list' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second bullet item with additional description' }] }] }
            ]
          },
          {
            type: 'orderedList',
            attrs: { start: 1 },
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step number one' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step number two' }] }] }
            ]
          }
        ]
      }
    },
    {
      slug: 'test-tables',
      title: 'Test Page - Structured Tables & Checklists',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Table Rendering & Task Checklists' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Below is a fully structured table rendering product tiers. This tests table cells, columns, and layout rendering.' }]
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Starter Plan' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edge Pro' }] }] }
                ]
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Serverless Scaling' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Limited (100k reqs)' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unlimited (Global)' }] }] }
                ]
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dynamic Plugins' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Disabled' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Enabled (Isolated)' }] }] }
                ]
              }
            ]
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Task Checklists' }]
          },
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review visual modal changes (Completed)' }] }] },
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verify delete permanently type confirmations' }] }] },
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build and release new blog posts' }] }] }
            ]
          }
        ]
      }
    },
    {
      slug: 'test-code-blocks',
      title: 'Test Page - Technical Code Snippets',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Technical Documentation & Code Snippets' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This page displays technical code blocks to verify code syntax formatting.' }]
          },
          {
            type: 'codeBlock',
            attrs: { language: 'javascript' },
            content: [{ type: 'text', text: 'const greeting = \'Welcome to NuxFlow!\';\nconsole.log(greeting);\n\n// Trigger delete warning\nfunction confirmDelete() {\n  return confirm(\'Are you sure?\');\n}' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'And here is a CSS block snippet:' }]
          },
          {
            type: 'codeBlock',
            attrs: { language: 'css' },
            content: [{ type: 'text', text: '.nux-destructive-button {\n  background-color: #ef4444 !important;\n  color: #ffffff !important;\n  font-weight: 600;\n}' }]
          }
        ]
      }
    },
    {
      slug: 'test-canvas-blocks',
      title: 'Test Page - Beautiful Canvas Hero Block',
      content: {
        type: 'canvas',
        blocks: [
          {
            id: ulid(),
            type: 'canvas-hero',
            props: {
              headline: 'Dynamic Canvas Visual Block',
              subtext: 'This hero block was dynamically injected using a custom developer seeder route. It verifies layout width, button padding, alignment, and modern style gradients.',
              ctaLabel: 'View Pages Index',
              ctaUrl: '/admin/content',
              align: 'center',
              bgGradient: 'linear-gradient(to bottom right, #0c4a6e, #0369a1, #0c4a6e)',
              textColor: '#ffffff',
              ctaBgColor: '#38bdf8',
              logoIcon: 'i-lucide-sparkles',
              showDecorations: true,
              padding: { top: 80, right: 24, bottom: 80, left: 24, unit: 'px' }
            }
          }
        ]
      }
    }
  ]

  // 5. Delete existing test pages with matching slugs first to avoid duplicates
  for (const page of testPages) {
    await db.delete(contentItems).where(
      eq(contentItems.slug, page.slug)
    )
  }

  // 6. Insert new test pages
  for (const page of testPages) {
    await db.insert(contentItems).values({
      id: ulid(),
      siteId: site.id,
      typeId: pageType.id,
      authorId: user.id,
      title: page.title,
      slug: page.slug,
      status: 'published',
      visibility: 'public',
      content: page.content,
      seoTitle: page.title,
      seoDescription: `Auto-seeded page for testing: ${page.title}`,
      publishedAt: new Date().toISOString()
    })
  }

  return {
    success: true,
    message: 'Successfully seeded 4 beautifully formatted test pages!',
    pages: testPages.map(p => ({
      title: p.title,
      slug: p.slug,
      localUrl: `http://localhost:3000/${p.slug}`,
      liveUrl: `https://${site.domain}/${p.slug}`
    }))
  }
})
