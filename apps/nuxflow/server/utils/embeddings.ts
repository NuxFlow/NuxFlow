import { embed } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import type { H3Event } from 'h3'
import { getWorkersAiBinding, getVectorizeIndex } from './cf-env'

// 768-dim — the Vectorize index must be created with matching dimensions
// (`wrangler vectorize create ... --dimensions=768 --metric=cosine`, see
// wrangler.toml.example). Dimensions are immutable after index creation, so changing this
// model later means recreating the index and re-embedding every content item.
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'

/**
 * Embeds arbitrary text via Workers AI. Returns null when the AI binding isn't available
 * (self-hoster without the [ai] binding, or local dev without --remote) — every caller
 * treats null as "semantic search/embeddings unavailable" rather than throwing, since this
 * is always a best-effort enrichment layered on top of FTS5, never a hard dependency.
 */
async function embedText(event: H3Event, text: string): Promise<number[] | null> {
  const ai = getWorkersAiBinding(event)
  if (!ai) return null
  const workersai = createWorkersAI({ binding: ai })
  const { embedding } = await embed({ model: workersai.textEmbedding(EMBEDDING_MODEL), value: text })
  return embedding
}

/**
 * Same searchable text FTS5 already indexes (see migrations/0002_search_index.sql's
 * `COALESCE(excerpt, seo_description, '')`) — kept identical so semantic search and keyword
 * search cover the same content, not two subtly different corpora.
 */
function buildEmbeddingText(title: string, excerpt: string | null | undefined, seoDescription: string | null | undefined): string {
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

    const values = await embedText(event, text)
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

export interface SemanticMatch {
  contentItemId: string
  score: number
  title?: string
}

/**
 * Returns the top-K semantically similar published/public content items for a query, or
 * null when Vectorize isn't configured (caller falls back to FTS5-only search — see
 * search/semantic.get.ts). Scoped to `siteId` via the namespace partition described above,
 * not a metadata filter, so a query can never leak matches from a different tenant.
 */
export async function semanticSearch(event: H3Event, siteId: string, query: string, topK = 10): Promise<SemanticMatch[] | null> {
  const index = getVectorizeIndex(event)
  if (!index) return null

  const values = await embedText(event, query)
  if (!values) return null

  const result = await index.query(values, { topK, namespace: siteId, returnMetadata: 'indexed' })
  return result.matches.map(m => ({
    contentItemId: m.id,
    score: m.score,
    title: (m.metadata?.title as string) ?? undefined,
  }))
}
