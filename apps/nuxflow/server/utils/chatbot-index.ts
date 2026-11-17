import type { H3Event } from 'h3'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { chatChunks, chatKnowledge, contentItems, siteSettings, sites } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getVectorizeIndex } from './cf-env'
import { embedTextsForRebuild, getSearchIndexInfo, type SearchIndexInfo } from './embeddings'
import { AI_CREDITS, checkAiAllowance, recordAiCall } from './ai-allowance'
import { getSeoSettings } from './seo'
import { getIndexableEntries } from './sitemap-entries'
import { contentToMarkdown } from './markdown'
import { sha256Hex } from './buffer'
import { chatbotIncluded } from './chatbot'
import { isServedCopy } from './move-state'
import { chunk } from '../../shared/lib/array'
import { CHATBOT_SETTING_KEY, chatNamespace, chunkText, knowledgeText, parseChatbotSettings, type ChatbotIndexStatus, type ChatbotSettings } from '../../shared/lib/chatbot'

/**
 * What the chatbot learns: each enabled site's published, public pages (those smart search
 * and the sitemap list, optionally only some content types) and its knowledge entries,
 * split into chunks (chunkText()) and embedded into the shared Vectorize index under the
 * namespace `chat:<siteId>`. Every chunk also has a chat_chunks row — Vectorize can only
 * delete by id, and the bot reads the text from there.
 *
 * No hook on any content write path: the every-minute `chatbot-index` task notices changes
 * itself. Three grouped queries compare, per enabled site, the count and newest updated_at
 * of its pages and knowledge (plus the index model and the content-type filter) with the
 * stamp saved after its last complete sync; only a site whose stamp differs is looked at,
 * source by source (a page whose updated_at moved but whose text didn't isn't re-embedded).
 * This also covers the first fill, unpublished and deleted pages, and an index model change.
 *
 * Charged to the site's chat allowance: AI_CREDITS.chatChunksPerCredit chunks a credit. A
 * site out of chat credits simply waits.
 */

/** Server-managed: the fingerprint of what the last complete sync covered. */
export const CHATBOT_INDEX_STAMP_KEY = 'chatbot.index_stamp'

/** Chunks embedded per task run, across all sites — a few Workers AI calls. */
const CHUNKS_PER_RUN = 300
/** Texts per Workers AI embedding call. */
const EMBED_BATCH = 50
/** Most pages one site's bot learns from. */
const MAX_SOURCES = 2000
// D1 allows 100 bound parameters per statement; a chat_chunks row binds 11.
const ROWS_PER_INSERT = 8

interface Source {
  kind: 'content' | 'knowledge'
  id: string
  title: string
  path: string | null
  updatedAt: string
}

interface ExistingSource {
  kind: 'content' | 'knowledge'
  id: string
  updatedAt: string
  model: string
  hash: string
}

const key = (kind: string, id: string) => `${kind}:${id}`

async function desiredSources(db: Db, siteId: string, settings: ChatbotSettings): Promise<Source[]> {
  const seo = await getSeoSettings(db, siteId)
  const [{ entries }, knowledge] = await Promise.all([
    getIndexableEntries(db, siteId, seo, MAX_SOURCES),
    db.select({ id: chatKnowledge.id, title: chatKnowledge.title, updatedAt: chatKnowledge.updatedAt })
      .from(chatKnowledge)
      .where(and(eq(chatKnowledge.siteId, siteId), eq(chatKnowledge.enabled, true))),
  ])
  const types = new Set(settings.contentTypes)
  return [
    ...entries
      .filter(e => !types.size || (e.typeSlug && types.has(e.typeSlug)))
      .map(e => ({ kind: 'content' as const, id: e.id, title: e.title, path: e.path, updatedAt: e.updatedAt })),
    ...knowledge.map(k => ({ kind: 'knowledge' as const, id: k.id, title: k.title, path: null, updatedAt: k.updatedAt })),
  ]
}

async function existingSources(db: Db, siteId: string): Promise<Map<string, ExistingSource>> {
  const rows = await db.select({
    kind: chatChunks.sourceKind,
    id: chatChunks.sourceId,
    updatedAt: sql<string>`max(${chatChunks.sourceUpdatedAt})`,
    model: sql<string>`max(${chatChunks.model})`,
    hash: sql<string>`max(${chatChunks.hash})`,
  })
    .from(chatChunks)
    .where(eq(chatChunks.siteId, siteId))
    .groupBy(chatChunks.sourceKind, chatChunks.sourceId)
  return new Map(rows.map(r => [key(r.kind, r.id), r]))
}

function needsWork(s: Source, existing: ExistingSource | undefined, model: string): boolean {
  return !existing || existing.updatedAt !== s.updatedAt || existing.model !== model
}

/** The text a source is learnt from: the page's title and Markdown body, or the knowledge entry. */
async function sourceTexts(db: Db, siteId: string, list: Source[]): Promise<Map<string, { title: string; body: string }>> {
  const out = new Map<string, { title: string; body: string }>()
  const contentIds = list.filter(s => s.kind === 'content').map(s => s.id)
  const knowledgeIds = list.filter(s => s.kind === 'knowledge').map(s => s.id)
  for (const ids of chunk(contentIds, 20)) {
    const rows = await db.select({ id: contentItems.id, title: contentItems.title, excerpt: contentItems.excerpt, content: contentItems.content })
      .from(contentItems)
      .where(and(eq(contentItems.siteId, siteId), inArray(contentItems.id, ids)))
    for (const r of rows) {
      const body = [r.excerpt?.trim(), contentToMarkdown(r.content)].filter(Boolean).join('\n\n')
      out.set(key('content', r.id), { title: r.title, body })
    }
  }
  for (const ids of chunk(knowledgeIds, 50)) {
    const rows = await db.select({ id: chatKnowledge.id, kind: chatKnowledge.kind, title: chatKnowledge.title, body: chatKnowledge.body })
      .from(chatKnowledge)
      .where(and(eq(chatKnowledge.siteId, siteId), inArray(chatKnowledge.id, ids)))
    for (const r of rows) out.set(key('knowledge', r.id), knowledgeText(r.kind, r.title, r.body))
  }
  return out
}

async function chunkIdsFor(db: Db, siteId: string, sources: { kind: 'content' | 'knowledge'; id: string }[]): Promise<string[]> {
  const ids: string[] = []
  for (const kind of ['content', 'knowledge'] as const) {
    for (const group of chunk(sources.filter(s => s.kind === kind).map(s => s.id), 50)) {
      const rows = await db.select({ id: chatChunks.id }).from(chatChunks)
        .where(and(eq(chatChunks.siteId, siteId), eq(chatChunks.sourceKind, kind), inArray(chatChunks.sourceId, group)))
      ids.push(...rows.map(r => r.id))
    }
  }
  return ids
}

async function deleteChunkRows(event: H3Event, db: Db, siteId: string, ids: string[]): Promise<void> {
  const index = getVectorizeIndex(event)
  for (const group of chunk(ids, 500)) {
    if (index) await index.deleteByIds(group)
    for (const rows of chunk(group, 90)) {
      await db.delete(chatChunks).where(and(eq(chatChunks.siteId, siteId), inArray(chatChunks.id, rows)))
    }
  }
}

/** Removes every vector the site's chatbot has (site deletion — the rows go with the FK cascade). */
export async function deleteChatVectors(event: H3Event, db: Db, siteId: string): Promise<void> {
  const index = getVectorizeIndex(event)
  if (!index) return
  const rows = await db.select({ id: chatChunks.id }).from(chatChunks).where(eq(chatChunks.siteId, siteId))
  for (const group of chunk(rows.map(r => r.id), 500)) {
    try {
      await index.deleteByIds(group)
    }
    catch (err) {
      console.error(`[chatbot-index] Failed to delete ${group.length} vectors:`, err)
    }
  }
}

export interface SiteSyncResult {
  done: boolean
  embedded: number
  /** Why it stopped early, if it did. */
  stopped?: 'budget' | 'allowance' | 'no-index'
}

/**
 * Brings one site's chatbot knowledge up to date, embedding at most `budget` chunks.
 * `event` must carry the site (context.siteId) — usage and the allowance are counted on it.
 */
export async function syncSiteChatIndex(event: H3Event, db: Db, siteId: string, settings: ChatbotSettings, budget = CHUNKS_PER_RUN): Promise<SiteSyncResult> {
  const index = getVectorizeIndex(event)
  const info = await getSearchIndexInfo(event)
  if (!index || !info?.model || !info.dimensions) return { done: false, embedded: 0, stopped: 'no-index' }
  const model = info.model.id

  const [desired, existing] = await Promise.all([desiredSources(db, siteId, settings), existingSources(db, siteId)])
  const wanted = new Set(desired.map(s => key(s.kind, s.id)))

  // Pages no longer published (or filtered out), knowledge deleted or switched off.
  const gone = [...existing.values()].filter(e => !wanted.has(key(e.kind, e.id)))
  if (gone.length) await deleteChunkRows(event, db, siteId, await chunkIdsFor(db, siteId, gone))

  const todo = desired.filter(s => needsWork(s, existing.get(key(s.kind, s.id)), model))
  let embedded = 0
  for (const group of chunk(todo, 10)) {
    const texts = await sourceTexts(db, siteId, group)
    for (const source of group) {
      const text = texts.get(key(source.kind, source.id))
      const prior = existing.get(key(source.kind, source.id))
      if (!text) continue
      const hash = await sha256Hex(`${text.title}\n${text.body}`)

      // Saved again with no change to its text: just remember the new updated_at.
      if (prior && prior.hash === hash && prior.model === model) {
        await db.update(chatChunks).set({ sourceUpdatedAt: source.updatedAt, path: source.path })
          .where(and(eq(chatChunks.siteId, siteId), eq(chatChunks.sourceKind, source.kind), eq(chatChunks.sourceId, source.id)))
        continue
      }

      const pieces = chunkText(text.title, text.body)
      if (embedded + pieces.length > budget && embedded > 0) return { done: false, embedded, stopped: 'budget' }
      const credits = Math.max(1, Math.ceil(pieces.length / AI_CREDITS.chatChunksPerCredit))
      if (pieces.length && !(await checkAiAllowance(event, credits, 'chat', siteId)).allowed) return { done: false, embedded, stopped: 'allowance' }

      await replaceSourceChunks(event, db, siteId, source, pieces, { hash, model, info, credits })
      embedded += pieces.length
    }
  }
  return { done: true, embedded }
}

async function replaceSourceChunks(
  event: H3Event, db: Db, siteId: string, source: Source, pieces: string[],
  opts: { hash: string; model: string; info: SearchIndexInfo; credits: number },
): Promise<void> {
  const index = getVectorizeIndex(event)!
  const oldIds = await chunkIdsFor(db, siteId, [source])
  const rows: (typeof chatChunks.$inferInsert)[] = []
  if (pieces.length) {
    const vectors: Array<number[] | null> = []
    try {
      for (const batch of chunk(pieces, EMBED_BATCH)) vectors.push(...await embedTextsForRebuild(event, batch, opts.info))
    }
    finally {
      // Charged whether or not it worked, like every other AI call (no free retries).
      recordAiCall(event, 'platform', opts.credits, 'chat')
    }
    const upserts: VectorizeVector[] = []
    pieces.forEach((text, n) => {
      const values = vectors[n]
      if (!values) return
      const id = ulid()
      rows.push({ id, siteId, sourceKind: source.kind, sourceId: source.id, n, title: source.title, path: source.path, text, hash: opts.hash, sourceUpdatedAt: source.updatedAt, model: opts.model })
      upserts.push({ id, values, namespace: chatNamespace(siteId) })
    })
    // Rows first: a vector found before its row exists is skipped; a row without a vector just isn't found.
    for (const group of chunk(rows, ROWS_PER_INSERT)) await db.insert(chatChunks).values(group)
    for (const group of chunk(upserts, 500)) await index.upsert(group)
  }
  // Then the old version goes (new first, so the bot never knows nothing about the page).
  if (oldIds.length) await deleteChunkRows(event, db, siteId, oldIds)
}

// ── Which sites need work ─────────────────────────────────────────────────────────────

/** Sites with the chatbot switched on (the stored JSON's `enabled`), for the task. */
function enabledSiteIds(db: Db) {
  return db.select({ siteId: siteSettings.siteId }).from(siteSettings)
    .where(and(eq(siteSettings.key, CHATBOT_SETTING_KEY), sql`json_extract(${siteSettings.value}, '$.enabled') = 1`))
}

export interface ChatIndexCandidate {
  siteId: string
  domain: string
  settings: ChatbotSettings
  stamp: string
}

/** The fingerprint compared with the stamp: index model, filter, and each kind's count + newest edit. */
export function chatIndexStamp(model: string, settings: ChatbotSettings, content: { n: number; latest: string | null } | undefined, knowledge: { n: number; latest: string | null } | undefined): string {
  return [
    model,
    [...settings.contentTypes].sort().join(','),
    `${content?.n ?? 0}:${content?.latest ?? ''}`,
    `${knowledge?.n ?? 0}:${knowledge?.latest ?? ''}`,
  ].join('|')
}

/** Enabled sites whose pages or knowledge changed since their last complete sync. */
export async function sitesNeedingChatIndex(event: H3Event, db: Db): Promise<ChatIndexCandidate[]> {
  const info = await getSearchIndexInfo(event)
  if (!info?.model || !info.dimensions) return []
  const enabled = enabledSiteIds(db)
  const [siteRows, settingRows, stampRows, contentRows, knowledgeRows] = await Promise.all([
    db.select({ id: sites.id, domain: sites.domain, status: sites.status, moveState: sites.moveState }).from(sites).where(inArray(sites.id, enabled)),
    db.select({ siteId: siteSettings.siteId, value: siteSettings.value }).from(siteSettings)
      .where(and(eq(siteSettings.key, CHATBOT_SETTING_KEY), inArray(siteSettings.siteId, enabled))),
    db.select({ siteId: siteSettings.siteId, value: siteSettings.value }).from(siteSettings)
      .where(and(eq(siteSettings.key, CHATBOT_INDEX_STAMP_KEY), inArray(siteSettings.siteId, enabled))),
    db.select({ siteId: contentItems.siteId, n: sql<number>`count(*)`, latest: sql<string | null>`max(${contentItems.updatedAt})` })
      .from(contentItems)
      .where(and(inArray(contentItems.siteId, enabled), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')))
      .groupBy(contentItems.siteId),
    db.select({ siteId: chatKnowledge.siteId, n: sql<number>`count(*)`, latest: sql<string | null>`max(${chatKnowledge.updatedAt})` })
      .from(chatKnowledge)
      .where(inArray(chatKnowledge.siteId, enabled))
      .groupBy(chatKnowledge.siteId),
  ])
  const settingsBy = new Map(settingRows.map(r => [r.siteId, parseChatbotSettings(r.value)]))
  const stampBy = new Map(stampRows.map(r => [r.siteId, String(r.value ?? '')]))
  const contentBy = new Map(contentRows.map(r => [r.siteId, r]))
  const knowledgeBy = new Map(knowledgeRows.map(r => [r.siteId, r]))

  const out: ChatIndexCandidate[] = []
  for (const site of siteRows) {
    // A suspended site, or a copy mid-move that isn't the live one, learns nothing.
    if (site.status === 'suspended' || !isServedCopy(site.moveState)) continue
    const settings = settingsBy.get(site.id)
    if (!settings?.enabled) continue
    const stamp = chatIndexStamp(info.model.id, settings, contentBy.get(site.id), knowledgeBy.get(site.id))
    if (stampBy.get(site.id) === stamp) continue
    if (!(await chatbotIncluded(db, site.id))) continue
    out.push({ siteId: site.id, domain: site.domain, settings, stamp })
  }
  return out
}

/** The current stamp for one site (Admin → Chatbot → Update now saves it when that sync completes). */
export async function currentChatIndexStamp(event: H3Event, db: Db, siteId: string, settings: ChatbotSettings): Promise<string | null> {
  const info = await getSearchIndexInfo(event)
  if (!info?.model) return null
  const [[content], [knowledge]] = await Promise.all([
    db.select({ n: sql<number>`count(*)`, latest: sql<string | null>`max(${contentItems.updatedAt})` }).from(contentItems)
      .where(and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public'))),
    db.select({ n: sql<number>`count(*)`, latest: sql<string | null>`max(${chatKnowledge.updatedAt})` }).from(chatKnowledge)
      .where(eq(chatKnowledge.siteId, siteId)),
  ])
  return chatIndexStamp(info.model.id, settings, content, knowledge)
}

/** For Admin → Chatbot: how much of the site the bot has learnt. */
export async function chatIndexStatus(event: H3Event, db: Db, siteId: string, settings: ChatbotSettings): Promise<ChatbotIndexStatus> {
  const info = await getSearchIndexInfo(event)
  if (!getVectorizeIndex(event) || !info?.model) return { learnt: 0, pending: 0, chunks: 0, indexAvailable: false }
  const [desired, existing, [count]] = await Promise.all([
    desiredSources(db, siteId, settings),
    existingSources(db, siteId),
    db.select({ n: sql<number>`count(*)` }).from(chatChunks).where(eq(chatChunks.siteId, siteId)),
  ])
  const pending = desired.filter(s => needsWork(s, existing.get(key(s.kind, s.id)), info.model!.id)).length
  return { learnt: desired.length - pending, pending, chunks: Number(count?.n ?? 0), indexAvailable: true }
}
