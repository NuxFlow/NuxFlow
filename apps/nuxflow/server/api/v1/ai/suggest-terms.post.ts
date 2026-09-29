import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { getTaxonomyContentTypeSlugs } from '../../../utils/taxonomy'

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().max(8000).optional(),
  // Only suggest from taxonomies that apply to this content type (the editor's picker
  // shows the same subset).
  contentType: z.string().max(100).optional(),
})

// The model is asked to pick candidates by their index in a server-built list, never by
// ULID — LLMs are unreliable at reproducing an opaque id verbatim, and a wrong-but-
// plausible-looking id would silently fail to match anything server-side. An index into a
// list the server itself constructed is trivially validated (in-range or not) and can't
// reference a term that doesn't exist.
const suggestionSchema = z.object({
  matchedIndexes: z.array(z.number().int().nonnegative()).max(10)
    .describe('Indexes into the provided candidate term list that clearly apply to this content'),
  newTermSuggestions: z.array(z.object({
    taxonomySlug: z.string(),
    name: z.string().max(100),
  })).max(5).describe('Brand-new term names to propose only when no existing candidate is a good fit for that taxonomy'),
})

const SYSTEM = `You are a content tagging assistant for a CMS. Given a piece of content and a list of existing taxonomy terms (tags/categories), pick the ones that clearly apply. Only suggest a brand-new term when no existing one is a good fit — a few precise tags beat many loose ones.`

export default defineEventHandler(async (event) => {
  // Author, not editor: anyone who can tag their own content can ask for suggestions —
  // this only reads terms and never writes anything.
  const { userId } = await requireRole(event, 'author')
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-suggest-terms' })
  const model = await requireAiSdkModel(event, 'fast', { userId })

  const { title, body, contentType } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const allTaxonomies = await db.query.taxonomies.findMany({ where: eq(taxonomies.siteId, siteId) })
  const typesByTaxonomy = await getTaxonomyContentTypeSlugs(db, allTaxonomies.map(t => t.id))
  const siteTaxonomies = contentType
    ? allTaxonomies.filter((t) => {
        const types = typesByTaxonomy.get(t.id) ?? []
        return types.length === 0 || types.includes(contentType)
      })
    : allTaxonomies
  if (!siteTaxonomies.length) return { matchedTerms: [], newTermSuggestions: [] }

  const taxonomyIds = siteTaxonomies.map(t => t.id)
  const existingTerms = await db.query.taxonomyTerms.findMany({ where: inArray(taxonomyTerms.taxonomyId, taxonomyIds) })

  const taxonomySlugById = new Map(siteTaxonomies.map(t => [t.id, t.slug]))
  const candidates = existingTerms.map((term, index) => ({
    index,
    id: term.id,
    name: term.name,
    taxonomyId: term.taxonomyId,
    taxonomySlug: taxonomySlugById.get(term.taxonomyId) ?? '',
  }))

  const candidateList = candidates.map(c => `${c.index}. [${c.taxonomySlug}] ${c.name}`).join('\n') || '(none yet)'
  const taxonomySlugs = siteTaxonomies.map(t => t.slug).join(', ')
  const prompt = `Content title: ${title}\n${body ? `Content: ${body.slice(0, 2000)}\n` : ''}\nAvailable taxonomies: ${taxonomySlugs}\n\nExisting terms (pick by index number):\n${candidateList}`

  const { object } = await callAiOrThrow(() =>
    generateObject({ model, schema: suggestionSchema, system: SYSTEM, prompt, maxOutputTokens: 500 }),
  )

  const matchedTerms = object.matchedIndexes
    .map(i => candidates[i])
    .filter((c): c is typeof candidates[number] => Boolean(c))
    .map(c => ({ id: c.id, name: c.name, taxonomyId: c.taxonomyId, taxonomySlug: c.taxonomySlug }))

  // Drop proposals for a taxonomy the model invented or that doesn't apply here.
  const allowedSlugs = new Set(siteTaxonomies.map(t => t.slug))
  const newTermSuggestions = object.newTermSuggestions.filter(s => allowedSlugs.has(s.taxonomySlug))

  return { matchedTerms, newTermSuggestions }
})
