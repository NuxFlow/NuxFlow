import { embed, embedMany } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import type { H3Event } from 'h3'
import { getWorkersAiBinding, getVectorizeIndex } from './cf-env'
import { AI_CREDITS, checkAiAllowance, recordAiCall, type AiTrigger } from './ai-allowance'
import { createIsolateCache } from './isolate-cache'

/**
 * Embedding models by the vector size they produce. A Vectorize index's dimensions are
 * fixed when it's created, so the index decides the model — not a setting that could
 * disagree with it:
 *  - 1024 → bge-m3, multilingual (the default for new installs — wrangler.toml.example).
 *  - 768  → bge-base-en-v1.5, English only. Every deployment made before multilingual
 *    search has a 768 index and keeps working on it unchanged.
 * Switching an existing deployment = create a 1024 index, point the VECTORIZE binding at
 * it, deploy; the search-index-rebuild task then re-embeds every page by itself.
 */
export const EMBEDDING_MODELS = {
  1024: { id: '@cf/baai/bge-m3', multilingual: true },
  768: { id: '@cf/baai/bge-base-en-v1.5', multilingual: false },
} as const satisfies Record<number, { id: string; multilingual: boolean }>

export type EmbeddingModel = (typeof EMBEDDING_MODELS)[keyof typeof EMBEDDING_MODELS]

export interface SearchIndexInfo {
  dimensions: number | null
  /** Null when the index has a size no model here produces — nothing is embedded then. */
  model: EmbeddingModel | null
  vectorCount: number | null
}

// describe() is a network call; the dimensions can only change with a redeploy (a new
// binding), so ten minutes per isolate is plenty.
const indexInfoCache = createIsolateCache<SearchIndexInfo>(10 * 60_000)

export function clearSearchIndexInfoCache(): void {
  indexInfoCache.clear()
}

/**
 * What the bound index is and which model fills it. When describe() isn't available or
 * fails, assumes the original 768 index: embedText() still checks each vector's length
 * against known dimensions, and an unknown size is never written.
 */
export async function getSearchIndexInfo(event: H3Event): Promise<SearchIndexInfo | null> {
  const index = getVectorizeIndex(event)
  if (!index) return null
  const cached = indexInfoCache.get('info')
  if (cached) return cached
  if (typeof index.describe !== 'function') return { dimensions: null, model: EMBEDDING_MODELS[768], vectorCount: null }
  let info: SearchIndexInfo
  try {
    const d = (await index.describe() ?? {}) as { dimensions?: number, vectorCount?: number, config?: { dimensions?: number } }
    const dimensions = d.dimensions ?? d.config?.dimensions ?? null
    info = {
      dimensions,
      model: dimensions ? (EMBEDDING_MODELS as Record<number, EmbeddingModel>)[dimensions] ?? null : EMBEDDING_MODELS[768],
      vectorCount: d.vectorCount ?? null,
    }
    if (dimensions && !info.model) console.error(`[embeddings] The Vectorize index has ${dimensions} dimensions; no embedding model here makes those (768 or 1024). Semantic search is off.`)
  }
  catch (err) {
    console.error('[embeddings] Could not describe the Vectorize index; assuming 768 dimensions:', err)
    return { dimensions: null, model: EMBEDDING_MODELS[768], vectorCount: null }
  }
  indexInfoCache.set('info', info)
  return info
}

function rightSize(vector: number[] | undefined, info: SearchIndexInfo): vector is number[] {
  if (!vector?.length) return false
  if (info.dimensions && vector.length !== info.dimensions) {
    console.error(`[embeddings] ${info.model?.id} returned ${vector.length} values but the index has ${info.dimensions} dimensions — not written.`)
    return false
  }
  return true
}

/**
 * Embeds arbitrary text via Workers AI. Returns null when the AI binding isn't available
 * (self-hoster without the [ai] binding, or local dev without --remote) — every caller
 * treats null as "semantic search/embeddings unavailable" rather than throwing, since this
 * is always a best-effort enrichment layered on top of FTS5, never a hard dependency.
 *
 * Always platform-paid (the binding — the Vectorize index's dimensions rule out a site's own
 * key), so each embedding is charged AI_CREDITS.embedding: to the team allowance when an
 * editor's save re-indexes a page, to the visitor allowance for a search query. Once the
 * allowance is used up this returns null, the same as "unavailable".
 */
async function embedText(event: H3Event, text: string, trigger: AiTrigger): Promise<number[] | null> {
  const ai = getWorkersAiBinding(event)
  if (!ai) return null
  const info = await getSearchIndexInfo(event)
  if (!info?.model) return null
  if (!(await checkAiAllowance(event, AI_CREDITS.embedding, trigger)).allowed) return null
  const workersai = createWorkersAI({ binding: ai })
  try {
    const { embedding } = await embed({ model: workersai.textEmbedding(info.model.id), value: text })
    return rightSize(embedding, info) ? embedding : null
  }
  finally {
    recordAiCall(event, 'platform', AI_CREDITS.embedding, trigger)
  }
}

/**
 * Embeds many texts in one Workers AI call, for the index rebuild (search-index-rebuild.ts).
 * Not charged to any site's allowance: it's the operator's own maintenance of the shared
 * index, run once per index, not something a site's team or visitors did. Entries that
 * come back the wrong size are null.
 */
export async function embedTextsForRebuild(event: H3Event, texts: string[], info: SearchIndexInfo): Promise<Array<number[] | null>> {
  const ai = getWorkersAiBinding(event)
  if (!ai || !info.model || !texts.length) return texts.map(() => null)
  const workersai = createWorkersAI({ binding: ai })
  const { embeddings } = await embedMany({ model: workersai.textEmbedding(info.model.id), values: texts })
  return texts.map((_, i) => (rightSize(embeddings[i], info) ? embeddings[i]! : null))
}

/**
 * Same searchable text FTS5 already indexes (see migrations/0001_search_index.sql's
 * `COALESCE(excerpt, seo_description, '')`) — kept identical so semantic search and keyword
 * search cover the same content, not two subtly different corpora.
 */
export function buildEmbeddingText(title: string, excerpt: string | null | undefined, seoDescription: string | null | undefined): string {
  return `${title}\n\n${excerpt || seoDescription || ''}`.trim()
}

export interface ContentEmbeddingInput {
  contentItemId: string
  siteId: string
  title: string
  excerpt?: string | null
  seoDescription?: string | null
  status: string
  visibility: string
}

/**
 * Keeps a content item's Vectorize vector in sync with its current save — the application-
 * level equivalent of the FTS5 triggers, since a DB trigger can't call an external service
 * like Vectorize. Call this (via waitUntil, never inline — see content route call sites) from
 * every route that can change title/excerpt/seoDescription/status/visibility: content create,
 * update, and delete. Only `status = 'published' AND visibility = 'public'` items get a
 * vector, exactly matching FTS5's own indexing condition, so semantic search never surfaces
 * a draft or member-only page an unauthenticated searcher shouldn't see.
 *
 * The Vectorize index is a single shared index for the whole instance (not one per site) —
 * per-tenant isolation uses Vectorize's own `namespace` partition (max 64 bytes, siteId's
 * ULID fits easily) rather than metadata filtering, since a namespace is a hard boundary a
 * query can't accidentally cross, matching how every D1 table in this codebase is scoped by
 * `site_id`. The vector id is the content item's own ULID — already globally unique, so no
 * separate id-mapping table is needed.
 */
export async function upsertContentEmbedding(event: H3Event, input: ContentEmbeddingInput): Promise<void> {
  const index = getVectorizeIndex(event)
  if (!index) return

  try {
    if (input.status !== 'published' || input.visibility !== 'public') {
      // Covers the unpublish/restrict-visibility case — a previously-embedded item that's
      // now a draft or member-only must stop surfacing in semantic search results.
      await index.deleteByIds([input.contentItemId])
      return
    }

    const text = buildEmbeddingText(input.title, input.excerpt, input.seoDescription)
    if (!text) return

    const values = await embedText(event, text, 'team')
    if (!values) return

    await index.upsert([{
      id: input.contentItemId,
      values,
      namespace: input.siteId,
      metadata: { title: input.title },
    }])
  } catch (err) {
    // Best-effort enrichment, same philosophy as EXIF/image-dimension extraction in the
    // media upload path — a Vectorize hiccup must never surface as a failed content save,
    // especially since this always runs after the response has already been sent.
    console.error(`[embeddings] Failed to upsert embedding for content item ${input.contentItemId}:`, err)
  }
}

/** Removes a content item's vector — call on content delete. */
export async function deleteContentEmbedding(event: H3Event, contentItemId: string): Promise<void> {
  const index = getVectorizeIndex(event)
  if (!index) return
  try {
    await index.deleteByIds([contentItemId])
  } catch (err) {
    console.error(`[embeddings] Failed to delete embedding for content item ${contentItemId}:`, err)
  }
}

/**
 * Removes every vector for a set of content items — site deletion, where the D1 rows go
 * with the FK cascade but the Vectorize namespace would otherwise keep them forever.
 * Batched: Vectorize accepts at most 1000 ids per deleteByIds() call.
 */
export async function deleteContentEmbeddings(event: H3Event, contentItemIds: string[]): Promise<void> {
  const index = getVectorizeIndex(event)
  if (!index || contentItemIds.length === 0) return
  for (let i = 0; i < contentItemIds.length; i += 1000) {
    const batch = contentItemIds.slice(i, i + 1000)
    try {
      await index.deleteByIds(batch)
    } catch (err) {
      console.error(`[embeddings] Failed to delete ${batch.length} embeddings:`, err)
    }
  }
}

/**
 * Vectorize always returns its topK nearest items, however far away they are — so a query
 * about something the site never mentions used to list ten unrelated pages. Two cuts:
 * an absolute floor (cosine similarity on bge-base-en-v1.5; unrelated text mostly scores
 * below it), and a relative one, so a single strong match isn't padded out with weak ones.
 * Starting values — tune them against a real site's queries.
 */
export const MIN_SEMANTIC_SCORE = 0.6
export const MAX_SCORE_GAP_FROM_BEST = 0.15

export function relevantMatches<T extends { score: number }>(matches: T[]): T[] {
  const best = Math.max(...matches.map(m => m.score))
  return matches.filter(m => m.score >= MIN_SEMANTIC_SCORE && best - m.score <= MAX_SCORE_GAP_FROM_BEST)
}

export interface SemanticMatch {
  contentItemId: string
  score: number
  title?: string
}

/**
 * Returns the top-K semantically similar published/public content items for a query, or
 * null when Vectorize isn't configured or the lookup fails (caller falls back to FTS5-only
 * search — see search/semantic.get.ts). Scoped to `siteId` via the namespace partition
 * described above, not a metadata filter, so a query can never leak matches from a
 * different tenant. `trigger` is 'visitor' for public search, 'team' for editor tools.
 * Weak matches are dropped (relevantMatches), so the list can be shorter than topK.
 */
export async function semanticSearch(event: H3Event, siteId: string, query: string, topK = 10, trigger: AiTrigger = 'visitor', excludeId?: string): Promise<SemanticMatch[] | null> {
  const index = getVectorizeIndex(event)
  if (!index) return null

  try {
    const values = await embedText(event, query, trigger)
    if (!values) return null

    const result = await index.query(values, { topK, namespace: siteId, returnMetadata: 'indexed' })
    // The excluded item (related posts searches with a page's own text, so the page itself
    // is the near-perfect best match) goes before the relevance cut, not after.
    return relevantMatches(result.matches.filter(m => m.id !== excludeId)).map(m => ({
      contentItemId: m.id,
      score: m.score,
      title: (m.metadata?.title as string) ?? undefined,
    }))
  }
  catch (err) {
    // Same best-effort rule as the upserts above: a Workers AI or Vectorize hiccup must
    // not turn the search page (or an AI writing tool) into a 500.
    console.error('[embeddings] Semantic search failed:', err)
    return null
  }
}
