// The starter sites that ship inside NuxFlow: text only (no images, no theme), so they work
// on every install, offline and before file storage is connected. Each builds the same
// NuxFlowBackup-shaped content a catalog starter's demo.json holds, and goes through the
// same restore code — so a built-in and a catalog starter differ only in where they come from.
import type { NuxFlowBackup } from '../backup-types'
import type { StarterSummary } from '../../../shared/lib/starters'
import { getTemplateBlocks, getHelloWorldPostContent, type SetupTemplate } from '../setup-templates'

export type StarterContent = Pick<NuxFlowBackup, 'content'> & Partial<Pick<NuxFlowBackup, 'settings' | 'menus' | 'forms' | 'taxonomies' | 'contentTypes'>>

interface BuiltinStarter {
  summary: Omit<StarterSummary, 'source' | 'previewUrl' | 'imageCount' | 'imageBytes' | 'needsStorage'>
  build: (siteName: string) => StarterContent
}

type BackupItem = NuxFlowBackup['content'][number]

function homepage(template: SetupTemplate, siteName: string): BackupItem {
  return {
    typeSlug: 'page',
    slug: 'home',
    title: siteName,
    status: 'published',
    visibility: 'public',
    content: { type: 'canvas', blocks: getTemplateBlocks(template, siteName) },
    excerpt: null,
    seoTitle: siteName,
    seoDescription: `Welcome to ${siteName}`,
    ogImage: null,
    publishedAt: new Date().toISOString(),
    settings: null,
    termSlugs: [],
    locale: null,
    sourceItemSlug: null,
  }
}

function fromTemplate(template: SetupTemplate) {
  return (siteName: string): StarterContent => {
    const content: BackupItem[] = [homepage(template, siteName)]
    if (template === 'blog') {
      content.push({
        typeSlug: 'post',
        slug: 'hello-world',
        title: 'Hello World!',
        status: 'published',
        visibility: 'public',
        content: getHelloWorldPostContent(),
        excerpt: null,
        seoTitle: 'Hello World! - Welcome to NuxFlow',
        seoDescription: 'This is the first seeded post on your new edge-native blog.',
        ogImage: null,
        publishedAt: new Date().toISOString(),
        settings: null,
        termSlugs: [],
        locale: null,
        sourceItemSlug: null,
      })
    }
    return { content }
  }
}

export const BUILTIN_STARTERS: readonly BuiltinStarter[] = [
  {
    summary: {
      id: 'landing', name: 'Business', category: 'Business', version: '1',
      description: 'A home page with a hero, three features and a call to action.',
      icon: 'i-lucide-rocket', gradient: 'from-blue-500 to-indigo-600',
    },
    build: fromTemplate('landing'),
  },
  {
    summary: {
      id: 'blog', name: 'Blog', category: 'Writing', version: '1',
      description: 'Posts first, with a welcome post to edit.',
      icon: 'i-lucide-book-open', gradient: 'from-emerald-400 to-teal-600',
    },
    build: fromTemplate('blog'),
  },
  {
    summary: {
      id: 'portfolio', name: 'Portfolio', category: 'Creative', version: '1',
      description: 'Show your work, with a project showcase and a contact call to action.',
      icon: 'i-lucide-folder-open', gradient: 'from-amber-400 to-orange-500',
    },
    build: fromTemplate('portfolio'),
  },
  {
    summary: {
      id: 'blank', name: 'Blank', category: 'Minimal', version: '1',
      description: 'An empty home page to build on yourself.',
      icon: 'i-lucide-drafting-compass', gradient: 'from-gray-400 to-gray-600',
    },
    build: fromTemplate('blank'),
  },
]

export const DEFAULT_STARTER_ID = 'landing'

export function getBuiltinStarter(id: string): BuiltinStarter | undefined {
  return BUILTIN_STARTERS.find(s => s.summary.id === id)
}

export function builtinStarterSummaries(): StarterSummary[] {
  return BUILTIN_STARTERS.map(s => ({
    ...s.summary,
    source: 'builtin',
    previewUrl: null,
    imageCount: 0,
    imageBytes: 0,
    needsStorage: false,
  }))
}
