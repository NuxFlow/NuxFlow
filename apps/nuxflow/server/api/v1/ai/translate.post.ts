import { z } from 'zod'
import { generateText } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { getAiSdkModel, aiErrorMessage } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  contentItemId: z.string(),
  targetLocale: z.string().min(2).max(10),
  targetSlugSuffix: z.string().optional(),
})

// Extract all translatable string values from a TipTap JSON tree.
function extractTipTapStrings(node: unknown, out: Map<string, string>, path: string) {
  if (typeof node !== 'object' || !node) return
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') {
    out.set(path, n.text)
  }
  if (Array.isArray(n.content)) {
    n.content.forEach((child, i) => extractTipTapStrings(child, out, `${path}.${i}`))
  }
}

function applyTipTapTranslations(node: unknown, translations: Record<string, string>, path: string): unknown {
  if (typeof node !== 'object' || !node) return node
  const n = { ...(node as Record<string, unknown>) }
  if (n.type === 'text' && typeof n.text === 'string' && translations[path]) {
    return { ...n, text: translations[path] }
  }
  if (Array.isArray(n.content)) {
    n.content = n.content.map((child, i) => applyTipTapTranslations(child, translations, `${path}.${i}`))
  }
  return n
}

// Extract translatable strings from canvas block props.
// Only string-valued props whose keys suggest text content are extracted.
const TEXT_PROP_KEYS = new Set([
  'headline', 'subtext', 'title', 'description', 'content', 'caption', 'quote', 'author',
  'role', 'company', 'text', 'label', 'btnLabel', 'ctaLabel', 'cta2Label', 'sectionLabel',
  'sectionTitle', 'sectionDesc', 'feat1Title', 'feat1Desc', 'feat2Title', 'feat2Desc',
  'feat3Title', 'feat3Desc', 'feat4Title', 'feat4Desc',
  'copyrightText', 'logoText', 'col1Title', 'col2Title', 'acceptLabel', 'declineLabel',
  'policyLabel', 'plan1Name', 'plan2Name', 'plan3Name', 'itemsJson', 'plan1Features',
  'plan2Features', 'plan3Features', 'col1Links', 'col2Links',
])

// Structural shape shared with CanvasBlockData (@nuxflow/canvas) — declared
// locally to avoid coupling this route to the canvas package for one type.
interface CanvasBlockLike {
  id: string
  props?: Record<string, unknown>
  children?: Record<string, CanvasBlockLike[]>
}

function extractCanvasStrings(content: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const c = content as { blocks?: CanvasBlockLike[] }
  if (!Array.isArray(c?.blocks)) return out
  extractFromBlocks(c.blocks, out)
  return out
}

// Recurses into block.children so text nested inside Columns/Container blocks
// is translated too, not just root-level block props.
function extractFromBlocks(blocks: CanvasBlockLike[], out: Map<string, string>) {
  for (const block of blocks) {
    if (block.props) {
      for (const [key, val] of Object.entries(block.props)) {
        if (TEXT_PROP_KEYS.has(key) && typeof val === 'string' && val.trim()) {
          out.set(`${block.id}.${key}`, val)
        }
      }
    }
    if (block.children) {
      for (const slotBlocks of Object.values(block.children)) {
        extractFromBlocks(slotBlocks, out)
      }
    }
  }
}

function applyCanvasTranslations(content: unknown, translations: Record<string, string>): unknown {
  const c = content as { type: string; blocks: CanvasBlockLike[] }
  return {
    ...c,
    blocks: c.blocks.map(block => applyToBlock(block, translations)),
  }
}

function applyToBlock(block: CanvasBlockLike, translations: Record<string, string>): CanvasBlockLike {
  return {
    ...block,
    props: block.props
      ? Object.fromEntries(
          Object.entries(block.props).map(([key, val]) => {
            const tKey = `${block.id}.${key}`
            return [key, translations[tKey] !== undefined ? translations[tKey] : val]
          }),
        )
      : block.props,
    children: block.children
      ? Object.fromEntries(
          Object.entries(block.children).map(([slot, slotBlocks]) => [
            slot,
            slotBlocks.map(b => applyToBlock(b, translations)),
          ]),
        )
      : block.children,
  }
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-translate' })

  const model = await getAiSdkModel(event, 'smart')
  if (!model) throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })

  const { contentItemId, targetLocale, targetSlugSuffix } = await readValidatedBody(event, bodySchema.parse)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const source = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, contentItemId), eq(contentItems.siteId, siteId))!,
  })
  if (!source) throw createError({ statusCode: 404, message: 'Content item not found' })

  // Build a map of { key -> original text } for everything needing translation
  const strings = new Map<string, string>()
  strings.set('__title__', source.title)
  if (source.seoTitle) strings.set('__seoTitle__', source.seoTitle)
  if (source.seoDescription) strings.set('__seoDescription__', source.seoDescription)
  if (source.excerpt) strings.set('__excerpt__', source.excerpt)

  const isCanvas = (source.content as Record<string, unknown> | null)?.type === 'canvas'

  if (isCanvas) {
    const canvasStrings = extractCanvasStrings(source.content)
    canvasStrings.forEach((val, key) => strings.set(key, val))
  } else if (source.content) {
    extractTipTapStrings(source.content, strings, 'root')
  }

  // Serialize strings to a numbered bundle for the AI
  const bundle: Record<string, string> = {}
  strings.forEach((val, key) => { bundle[key] = val })
  const bundleJson = JSON.stringify(bundle, null, 2)

  let rawResult: string
  try {
    const result = await generateText({
      model,
      system: `You are a professional translator. You will receive a JSON object where keys are internal identifiers and values are text strings. Translate ALL values to ${targetLocale}. Return ONLY valid JSON with the same keys and translated values. For HTML values, translate only the visible text inside tags, preserving all HTML tags and attributes exactly. For JSON array strings (like feature lists), translate the text values inside the JSON while keeping the JSON structure valid.`,
      prompt: `Translate to ${targetLocale}:\n\n${bundleJson}`,
      maxOutputTokens: Math.min(8192, Math.max(1000, bundleJson.length * 2)),
    })
    rawResult = result.text
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }

  let translations: Record<string, string>
  try {
    // Strip potential markdown code fences
    const cleaned = rawResult.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    translations = JSON.parse(cleaned) as Record<string, string>
  } catch {
    throw createError({ statusCode: 500, message: 'AI returned invalid translation JSON. Try again.' })
  }

  // Apply translations back to content
  let translatedContent: unknown = source.content
  if (isCanvas) {
    translatedContent = applyCanvasTranslations(source.content, translations)
  } else if (source.content) {
    translatedContent = applyTipTapTranslations(source.content, translations, 'root')
  }

  const translatedTitle = translations['__title__'] ?? source.title
  const slugSuffix = targetSlugSuffix || `-${targetLocale}`
  const newSlug = `${source.slug}${slugSuffix}`

  // Check if a translation already exists for this locale+source
  const existing = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.sourceItemId, source.id),
      eq(contentItems.locale, targetLocale),
    )!,
  })

  if (existing) {
    // Update the existing translation
    await db.update(contentItems)
      .set({
        title: translatedTitle,
        content: translatedContent,
        seoTitle: translations['__seoTitle__'] ?? existing.seoTitle,
        seoDescription: translations['__seoDescription__'] ?? existing.seoDescription,
        excerpt: translations['__excerpt__'] ?? existing.excerpt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(contentItems.id, existing.id))

    await writeAuditLog(event, userId, { action: 'update', resource: 'content_item', resourceId: existing.id })
    return { id: existing.id, locale: targetLocale, updated: true }
  }

  // Create a new translated content item
  const newId = ulid()
  await db.insert(contentItems).values({
    id: newId,
    siteId,
    typeId: source.typeId,
    authorId: userId,
    slug: newSlug,
    title: translatedTitle,
    status: 'draft',
    visibility: source.visibility,
    content: translatedContent,
    seoTitle: translations['__seoTitle__'] ?? null,
    seoDescription: translations['__seoDescription__'] ?? null,
    excerpt: translations['__excerpt__'] ?? null,
    locale: targetLocale,
    sourceItemId: source.id,
  })

  await writeAuditLog(event, userId, { action: 'create', resource: 'content_item', resourceId: newId })

  return { id: newId, locale: targetLocale, slug: newSlug, updated: false }
})
