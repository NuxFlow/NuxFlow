import type { H3Event } from 'h3'
import { and, asc, count, eq, gt, isNull, notInArray, or } from 'drizzle-orm'
import { contentItems, sites } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getCfBindings, getVectorizeIndex, getWorkersAiBinding } from './cf-env'
import { buildEmbeddingText, embedTextsForRebuild, getSearchIndexInfo, type EmbeddingModel } from './embeddings'

/**
 * Re-embeds every published, public page into the Vectorize index — after switching to a
 * multilingual index (a new model, so every old vector is meaningless to it), or to fill
 * an index that was added after the site already had content.
 *
 * It runs by itself: the every-minute `search-index-rebuild` task does a few batches per
 * run whenever the index's model differs from the one the last finished rebuild used (the
 * state lives in this Worker's PLUGIN_KV, so each pool rebuilds its own sites with no
 * control-plane involvement), and does nothing once it's done. Super Admin → Database can
 * start it over. Progress is resumable — a failed batch is retried on the next run.
 */

const STATE_KEY = 'search-index:rebuild'
/** Pages per Workers AI call / Vectorize upsert. */
const BATCH_SIZE = 100
/** Batches per task run — up to 500 pages a minute. */
const BATCHES_PER_RUN = 5

export interface SearchIndexRebuildState {
  /** The embedding model this rebuild fills the index with. */
  model: string
  status: 'running' | 'done'
  /** Last content item id done (ids are ULIDs, so this walks them in order). */
  cursor: string | null
  processed: number
  startedAt: string
  finishedAt?: string
  lastError?: string
}

async function readState(event: H3Event): Promise<SearchIndexRebuildState | null> {
  const { kv } = getCfBindings(event)
  if (!kv) return null
  return kv.get<SearchIndexRebuildState>(STATE_KEY, 'json')
}

async function writeState(event: H3Event, state: SearchIndexRebuildState): Promise<void> {
  const { kv } = getCfBindings(event)
  if (kv) await kv.put(STATE_KEY, JSON.stringify(state))
}

function freshState(model: EmbeddingModel): SearchIndexRebuildState {
  return { model: model.id, status: 'running', cursor: null, processed: 0, startedAt: new Date().toISOString() }
}

/** Published, public items of sites this Worker serves (not a copy mid-move — move-state.ts). */
function indexableWhere(cursor?: string | null) {
  return and(
    eq(contentItems.status, 'published'),
    eq(contentItems.visibility, 'public'),
    or(isNull(sites.moveState), notInArray(sites.moveState, ['incoming', 'moved'])),
    cursor ? gt(contentItems.id, cursor) : undefined,
  )
}

/** Starts the rebuild over (Super Admin → Database → Rebuild). The next task run picks it up. */
export async function restartSearchIndexRebuild(event: H3Event): Promise<SearchIndexRebuildState | null> {
  const info = await getSearchIndexInfo(event)
  if (!info?.model) return null
  const state = freshState(info.model)
  await writeState(event, state)
  return state
}

/** One task run: a few batches, or nothing when the index is already up to date. */
export async function runSearchIndexRebuild(event: H3Event, db: Db): Promise<SearchIndexRebuildState | null> {
  const index = getVectorizeIndex(event)
  if (!index || !getWorkersAiBinding(event) || !getCfBindings(event).kv) return null
  const info = await getSearchIndexInfo(event)
  // Unknown dimensions (describe() failed this time) must not look like a model change —
  // that would throw away the progress so far. Wait for the next run.
  if (!info?.model || !info.dimensions) return null

  const stored = await readState(event)
  let state = stored && stored.model === info.model.id ? stored : freshState(info.model)
  if (state.status === 'done') return state

  try {
    for (let b = 0; b < BATCHES_PER_RUN && state.status === 'running'; b++) {
      const rows = await db.select({
        id: contentItems.id,
        siteId: contentItems.siteId,
        title: contentItems.title,
        excerpt: contentItems.excerpt,
        seoDescription: contentItems.seoDescription,
      })
        .from(contentItems)
        .innerJoin(sites, eq(sites.id, contentItems.siteId))
        .where(indexableWhere(state.cursor))
        .orderBy(asc(contentItems.id))
        .limit(BATCH_SIZE)

      const items = rows.map(r => ({ ...r, text: buildEmbeddingText(r.title, r.excerpt, r.seoDescription) })).filter(r => r.text)
      if (items.length) {
        const vectors = await embedTextsForRebuild(event, items.map(i => i.text), info)
        const upserts = items.flatMap((item, i) => {
          const values = vectors[i]
          return values ? [{ id: item.id, values, namespace: item.siteId, metadata: { title: item.title } }] : []
        })
        if (upserts.length) await index.upsert(upserts)
      }

      state = {
        ...state,
        cursor: rows.at(-1)?.id ?? state.cursor,
        processed: state.processed + rows.length,
        lastError: undefined,
        ...(rows.length < BATCH_SIZE && { status: 'done' as const, finishedAt: new Date().toISOString() }),
      }
      await writeState(event, state)
    }
  }
  catch (err) {
    // Left where it got to; the next run tries the same batch again.
    console.error('[search-index-rebuild] Batch failed:', err)
    state = { ...state, lastError: err instanceof Error ? err.message : String(err) }
    await writeState(event, state)
  }
  return state
}

/** Super Admin → Database: the index, its model, and how far the rebuild has got. */
export async function searchIndexStatus(event: H3Event, db: Db) {
  const info = await getSearchIndexInfo(event)
  if (!info) return { available: false as const }
  const [state, [total]] = await Promise.all([
    readState(event),
    db.select({ n: count() }).from(contentItems).innerJoin(sites, eq(sites.id, contentItems.siteId)).where(indexableWhere()),
  ])
  return {
    available: true as const,
    dimensions: info.dimensions,
    model: info.model?.id ?? null,
    multilingual: info.model?.multilingual ?? false,
    vectorCount: info.vectorCount,
    indexablePages: total?.n ?? 0,
    rebuild: state && state.model === info.model?.id ? state : null,
  }
}
