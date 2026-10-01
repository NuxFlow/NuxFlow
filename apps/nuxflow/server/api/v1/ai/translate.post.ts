import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { applyCanvasTranslations, collectCanvasStrings } from '@nuxflow/canvas/ai'
import type { CanvasBlockData } from '@nuxflow/canvas'

const bodySchema = z.object({
  contentItemId: z.string(),
  // Becomes the translation's URL prefix (/es/about), so only a real language-tag shape.
  targetLocale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'Use a language code such as "es" or "pt-BR"'),
  targetSlugSuffix: z.string().optional(),
})

// generateObject (Vercel AI SDK) enforces this shape at the provider-call level instead of
// hand-parsing a generateText response — same reasoning as improve.post.ts/seo-suggest.post.ts's
// comments: the model doesn't always comply with a "return ONLY valid JSON" instruction, and
// this route used to need its own markdown-code-fence-stripping workaround for it. The keys
// here are dynamic (internal string-path identifiers built by extractTipTapStrings/
// collectCanvasStrings, e.g. "__title__" or "blockId.propKey"), not a fixed set known ahead of
// time, so the schema is a plain string->string record rather than a z.object() with named
// fields — this preserves the exact same `Record<string, string>` shape the old manual
// `JSON.parse()` produced, so every consumer below (translations['__title__'], etc.) keeps
// working unchanged.
const translationsSchema = z.record(z.string(), z.string())

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

// Translates `bundle` in chunks small enough that the model's reply always fits its
// output budget — a single call capped at 8,192 tokens used to fail outright (502) on a
// long page instead of translating it. Chunks run one after another to stay inside the
// provider's own rate limits.
const CHUNK_CHARS = 6000
const MAX_CHUNKS = 40

function chunkBundle(bundle: Map<string, string>): Array<Record<string, string>> {
  const chunks: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  let size = 0
  for (const [key, val] of bundle) {
    if (size > 0 && size + val.length > CHUNK_CHARS) {
      chunks.push(current)
      current = {}
      size = 0
    }
    current[key] = val
    size += val.length + key.length
  }
  if (size > 0) chunks.push(current)
  return chunks
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-translate' })

  const model = await requireAiSdkModel(event, 'smart', { userId })

  const { contentItemId, targetLocale, targetSlugSuffix } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const source = await getContentItemOrThrow(db, siteId, contentItemId, 'Content item not found')

  // Build a map of { key -> original text } for everything needing translation
  const strings = new Map<string, string>()
  strings.set('__title__', source.title)
  if (source.seoTitle) strings.set('__seoTitle__', source.seoTitle)
  if (source.seoDescription) strings.set('__seoDescription__', source.seoDescription)
  if (source.excerpt) strings.set('__excerpt__', source.excerpt)

  const isCanvas = (source.content as Record<string, unknown> | null)?.type === 'canvas'

  const canvasBlocks = isCanvas ? ((source.content as { blocks?: CanvasBlockData[] }).blocks ?? []) : []
  if (isCanvas) {
    collectCanvasStrings(canvasBlocks).forEach((val, key) => strings.set(key, val))
  } else if (source.content) {
    extractTipTapStrings(source.content, strings, 'root')
  }

  // Serialize strings to a numbered bundle for the AI
  const slugSuffix = targetSlugSuffix || `-${targetLocale}`
  const newSlug = `${source.slug}${slugSuffix}`

  const existing = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.sourceItemId, source.id),
      eq(contentItems.locale, targetLocale),
    )!,
  })

  // Checked before the (paid, rate-limited) AI call: slugs are unique per site, so an
  // unrelated item already using the translation's slug would otherwise surface as a raw
  // constraint error only after the translation had been generated.
  if (!existing) {
    const slugTaken = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, newSlug)),
      columns: { id: true },
    })
    if (slugTaken) throw conflict(`The slug "${newSlug}" is already in use — choose a different slug suffix`)
  }

  const chunks = chunkBundle(strings)
  if (chunks.length > MAX_CHUNKS) {
    throw createError({ statusCode: 413, message: 'This page is too long to translate in one go — split it into smaller pages first' })
  }

  const translations: Record<string, string> = {}
  for (const chunk of chunks) {
    const chunkJson = JSON.stringify(chunk, null, 2)
    const { object } = await callAiOrThrow(() =>
      generateObject({
        model,
        schema: translationsSchema,
        system: `You are a professional translator. You will receive a JSON object whose keys are internal identifiers and whose values are text. Translate every value into the language with code "${targetLocale}", returning an object with exactly the same keys. For HTML values, translate only the visible text, preserving every tag and attribute exactly. Keep brand names, product names, and URLs unchanged.`,
        prompt: `Translate to ${targetLocale}:\n\n${chunkJson}`,
        maxOutputTokens: Math.min(8192, Math.max(1000, chunkJson.length)),
      }),
    )
    // Only keys that were asked for — a hallucinated key must never land in the content.
    for (const key of Object.keys(chunk)) {
      if (typeof object[key] === 'string' && object[key].trim()) translations[key] = object[key]
    }
  }

  // Apply translations back to content
  let translatedContent: unknown = source.content
  if (isCanvas) {
    translatedContent = { ...(source.content as object), blocks: applyCanvasTranslations(canvasBlocks, translations) }
  } else if (source.content) {
    translatedContent = applyTipTapTranslations(source.content, translations, 'root')
  }

  const translatedTitle = translations['__title__'] ?? source.title

  if (existing) {
    // Update the existing translation
    const itemUpdate = db.update(contentItems)
      .set({
        title: translatedTitle,
        content: translatedContent,
        seoTitle: translations['__seoTitle__'] ?? existing.seoTitle,
        seoDescription: translations['__seoDescription__'] ?? existing.seoDescription,
        excerpt: translations['__excerpt__'] ?? existing.excerpt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(contentItems.id, existing.id))

    const updateAudit = buildAuditLogInsert(event, userId, { action: 'update', resource: 'content_item', resourceId: existing.id })
    await db.batch(updateAudit ? [itemUpdate, updateAudit] : [itemUpdate])
    return { id: existing.id, locale: targetLocale, updated: true }
  }

  // Create a new translated content item
  const newId = ulid()
  const itemInsert = db.insert(contentItems).values({
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

  const createAudit = buildAuditLogInsert(event, userId, { action: 'create', resource: 'content_item', resourceId: newId })
  await db.batch(createAudit ? [itemInsert, createAudit] : [itemInsert])

  return { id: newId, locale: targetLocale, slug: newSlug, updated: false }
})
