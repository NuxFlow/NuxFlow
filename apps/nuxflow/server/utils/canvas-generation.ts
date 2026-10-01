import { z } from 'zod'
import { generateObject, type LanguageModel } from 'ai'
import { ulid } from 'ulid'
import type { H3Event } from 'h3'
import { and, desc, eq, gt, like, not } from 'drizzle-orm'
import { aiBlockDefinitions, buildBlockCatalog, normalizeAiBlocks, type AiCapability, type AiMediaItem } from '@nuxflow/canvas/ai'
import type { CanvasBlockData, CanvasBlockDefinition } from '@nuxflow/canvas'
import { contentItems, contentTypes, forms, media, membershipTiers, sites } from '@nuxflow/db/schema'
import { callAiOrThrow } from './ai-sdk'
import { resolveSetting } from './settings'
import type { Db } from './db'

// Shared by generate-canvas.post.ts (the canvas editor's "Generate page" modal) and
// site-generation.ts (the Generate with AI page's single-page and whole-site jobs), so the
// prompt, schema, and output cleanup can't drift between the two.
//
// The block catalog is built from @nuxflow/canvas's own block definitions
// (buildBlockCatalog) rather than written out by hand here — a hand-kept list fell behind
// the real block library (it offered 11 of ~22 blocks, so a planned "Contact" page had no
// form block to use). Model output goes through normalizeAiBlocks(), which drops unknown
// blocks/fields and validates every value against its field definition.

export const TONES = ['professional', 'casual', 'friendly', 'bold', 'playful', 'technical'] as const
export const PAGE_GOALS = ['landing', 'about', 'product', 'pricing', 'contact', 'blog', 'general'] as const

export const canvasGenerationBodySchema = z.object({
  description: z.string().min(10).max(2000),
  tone: z.enum(TONES).optional().default('professional'),
  pageGoal: z.enum(PAGE_GOALS).optional().default('general'),
})

/** What the generator knows about the site it's designing for. */
export interface GenerationContext {
  siteName: string
  primaryColor: string
  darkMode: boolean
  forms: Array<{ slug: string; name: string }>
  media: AiMediaItem[]
  capabilities: Set<AiCapability>
  defs: CanvasBlockDefinition[]
}

// Images offered to the model, newest first. data: URIs (the local storage fallback) are
// skipped — each is up to ~700 KB of base64 that would be pasted into the stored props.
const MAX_MEDIA_IN_PROMPT = 30

export async function loadGenerationContext(event: H3Event, db: Db, siteId: string): Promise<GenerationContext> {
  const [site, primaryColor, darkMode, siteForms, siteMedia, tier, post, event_] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true } }),
    resolveSetting(event, 'theme.primary_color') as Promise<string | undefined>,
    resolveSetting(event, 'theme.dark_mode') as Promise<string | undefined>,
    db.query.forms.findMany({
      where: and(eq(forms.siteId, siteId), eq(forms.status, 'active')),
      columns: { slug: true, name: true },
      limit: 20,
    }),
    db.query.media.findMany({
      where: and(eq(media.siteId, siteId), like(media.mimeType, 'image/%'), not(like(media.url, 'data:%'))),
      columns: { url: true, altText: true, originalName: true, width: true, height: true },
      orderBy: [desc(media.createdAt)],
      limit: MAX_MEDIA_IN_PROMPT,
    }),
    db.query.membershipTiers.findFirst({
      where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.isActive, true)),
      columns: { id: true },
    }),
    db.select({ id: contentItems.id }).from(contentItems)
      .innerJoin(contentTypes, eq(contentTypes.id, contentItems.typeId))
      .where(and(eq(contentItems.siteId, siteId), eq(contentTypes.slug, 'post'), eq(contentItems.status, 'published')))
      .limit(1),
    db.select({ id: contentItems.id }).from(contentItems)
      .where(and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), gt(contentItems.eventStartAt, new Date().toISOString())))
      .limit(1),
  ])

  const capabilities = new Set<AiCapability>()
  if (siteMedia.length) capabilities.add('media')
  if (siteForms.length) capabilities.add('forms')
  if (tier) capabilities.add('tiers')
  if (post.length) capabilities.add('posts')
  if (event_.length) capabilities.add('events')

  return {
    siteName: site?.name ?? '',
    primaryColor: primaryColor ?? '',
    darkMode: darkMode === 'dark',
    forms: siteForms,
    media: siteMedia.map(m => ({ url: m.url, alt: m.altText || m.originalName, width: m.width, height: m.height })),
    capabilities,
    defs: aiBlockDefinitions(capabilities),
  }
}

// Children are one level deep (see normalizeAiBlocks) so the schema isn't recursive —
// several providers' structured-output modes reject recursive JSON schemas.
const leafBlockSchema = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
})
const blockSchema = leafBlockSchema.extend({
  children: z.array(z.object({ slot: z.string(), blocks: z.array(leafBlockSchema) }))
    .describe('Child blocks per slot — only for blocks that list child slots; otherwise an empty array'),
})
const responseSchema = z.object({
  title: z.string().describe('Page title, as it would appear in navigation (e.g. "About us")'),
  slug: z.string().describe('URL slug: lowercase, hyphenated, no leading slash. "home" for the homepage.'),
  blocks: z.array(blockSchema).min(1).max(16),
})

function systemPrompt(ctx: GenerationContext): string {
  const media = ctx.media.length
    ? ctx.media.map((m, i) => `media:${i} — ${m.alt || 'untitled image'}`).join('\n')
    : '(none — do not use image blocks)'
  const formsList = ctx.forms.length ? ctx.forms.map(f => `${f.slug} — ${f.name}`).join('\n') : '(none)'

  return `You are a web designer building pages${ctx.siteName ? ` for the website "${ctx.siteName}"` : ''} in NuxFlow, a block-based CMS. Compose each page as a sequence of blocks from the BLOCK LIBRARY.

BLOCK LIBRARY — use only these block types and fields:

${buildBlockCatalog(ctx.defs)}

MEDIA LIBRARY — the only images you may use, referenced by token:
${media}

FORMS:
${formsList}

Rules:
- Use only the block types and fields listed. Leave out any field you don't need — every block has sensible defaults.
- The site layout already provides the header, navigation menu, and footer. Never build a footer or navigation menu.
- Colours: leave colour fields unset so blocks follow the site's theme, unless the request asks for specific colours or a section genuinely needs contrast.${ctx.primaryColor ? ` The brand colour is ${ctx.primaryColor} — use it for any accent you do set.` : ''}${ctx.darkMode ? ' The site uses a dark colour scheme: any background you set should be dark, with light text.' : ''}
- Images: only "media:<n>" tokens from the MEDIA LIBRARY. Never invent image URLs; if nothing fits, leave the image out.
- Links: point buttons at the site's real pages when a SITE PAGES list is given, otherwise use "#".
- Copy: write specific, compelling copy for this business in the requested tone. No lorem ipsum. Don't invent facts the request doesn't support (statistics, awards, client names, prices); use clearly marked placeholders such as "[price]" instead.
- A typical page has 4-10 blocks. Open landing, home, and product pages with canvas-hero.`
}

export interface CanvasPageInput {
  description: string
  tone?: string
  pageGoal?: string
  /** The whole-site request this page belongs to, so every page shares one brand and voice. */
  siteBrief?: string
  /** Every page in the site being generated — for consistent naming and internal links. */
  sitePages?: Array<{ title: string; slug: string }>
}

export interface GeneratedCanvasContent {
  type: 'canvas'
  blocks: CanvasBlockData[]
}

export interface GeneratedCanvasPage {
  title: string
  slug: string
  content: GeneratedCanvasContent
}

export async function generateCanvasPage(model: LanguageModel, ctx: GenerationContext, input: CanvasPageInput): Promise<GeneratedCanvasPage> {
  const parts = [
    input.siteBrief && `This page is part of a website described as: """${input.siteBrief}"""`,
    input.sitePages?.length && `SITE PAGES (link to these by path):\n${input.sitePages.map(p => `/${p.slug === 'home' ? '' : p.slug} — ${p.title}`).join('\n')}`,
    `Design a ${input.pageGoal && input.pageGoal !== 'general' ? `${input.pageGoal} ` : ''}page: """${input.description}"""`,
    `Tone: ${input.tone ?? 'professional'}.`,
  ].filter(Boolean)

  const { object } = await callAiOrThrow(() =>
    generateObject({ model, schema: responseSchema, system: systemPrompt(ctx), prompt: parts.join('\n\n') }),
  )

  const blocks = normalizeAiBlocks(object.blocks, { defs: ctx.defs, media: ctx.media, newId: ulid })
  if (!blocks.length) {
    throw createError({ statusCode: 502, message: 'The AI returned no usable blocks — try again or rephrase the request.' })
  }
  return { title: object.title.trim(), slug: object.slug.trim(), content: { type: 'canvas', blocks } }
}
