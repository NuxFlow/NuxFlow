import type { H3Event } from 'h3'
import { and, asc, count, eq, gt, inArray, like, or, sql } from 'drizzle-orm'
import { contentItems, contentRevisions, media, menus, siteSettings, themes, userSiteRoles, users } from '@nuxflow/db/schema'
import { useDb } from './db'
import { bufferToHex } from './buffer'
import { getActiveProvider, type MediaProvider } from './media-providers/index'
import { sanitizeSvg } from './sanitize-css-svg'
import { saveSetting } from './settings'
import { purgeAllPublicPages, purgeEdgeCache } from './edge-cache'

/**
 * Moves media out of the database-storage fallback (base64 `data:` URIs in D1 — see the
 * `local` provider in media-providers/index.ts) into whichever real provider is now
 * active, and rewrites every reference to point at the new copy. Driven in small batches
 * by POST /api/v1/media/migration; the admin UI loops until a batch reports `done`.
 *
 * Two phases:
 *  - `media`  — media-library rows whose file lives in D1 (`storage_provider = 'local'`).
 *  - `inline` — images embedded straight into content/settings as data: URIs with no
 *               media-library row at all (AI-generated images, pasted images). Each gets
 *               a new media-library row as part of the move.
 *
 * Memory: rows that reference a file are found by id only, then loaded, rewritten, and
 * saved ONE AT A TIME. The first version loaded every referencing row at once — on a real
 * site where one image was embedded in 62 drafts (107 MB of content), that blew straight
 * through the Worker's 128 MB memory limit and the request died with a bare 503. Peak
 * memory is now roughly one row (≤ D1's 2 MB row cap) plus its rewritten copy.
 *
 * Work budget: each request also stops after a bounded number of D1 queries / seconds
 * (WorkBudget) — comfortably under Cloudflare's 1,000-queries-per-invocation cap — and
 * reports `done: false` with a cursor to resume from. A file whose references weren't all
 * rewritten yet is simply picked up again next request: already-rewritten rows no longer
 * match, so progress is never lost or repeated.
 *
 * Safety: a file is only considered moved once the new copy is confirmed to exist
 * (provider.exists(), or fetching its public URL). References are rewritten only after
 * that, and the database copy disappears only when the media row itself is updated last.
 * Every step is idempotent.
 */

const SUPPORTED_IMAGE_TYPES = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'avif', 'svg+xml'] as const

// Linear-time: one literal prefix, one bounded alternation, then a single character class.
const DATA_IMAGE_URI = /data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}/g

const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

// Ids per "which rows reference this file?" lookup. Only ids come back, so this bounds
// the number of lookups, not memory.
const ID_PAGE_SIZE = 50

export class MigrationUnavailableError extends Error {}

/**
 * Caps how much work one request does. D1 binding calls count toward Cloudflare's
 * per-invocation limit (1,000 on paid plans), and a long request also delays the UI's
 * progress updates — so each request stops well short of either and hands back a cursor.
 */
export class WorkBudget {
  private queries = 0
  private readonly deadline: number
  constructor(private readonly maxQueries = 400, maxMillis = 20_000) {
    this.deadline = Date.now() + maxMillis
  }

  spend(queries = 1): void {
    this.queries += queries
  }

  get exhausted(): boolean {
    return this.queries >= this.maxQueries || Date.now() >= this.deadline
  }
}

export interface MigrationItemResult {
  id: string
  ok: boolean
  error?: string
  newUrl?: string
}

export interface MigrationBatchResult {
  results: MigrationItemResult[]
  /** Pass back as `cursor` for the next batch. */
  nextCursor: string | null
  /** True once this phase has nothing left to do. */
  done: boolean
}

export interface MigrationStatus {
  provider: string
  /** True for binding-only R2: media is served through this Worker at /_nuxflow/media/. */
  servedByWorker: boolean
  canMigrate: boolean
  pendingMedia: number
  pendingMediaBytes: number
  pendingInline: number
}

export function decodeDataUri(uri: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri)
  if (!match) return null
  const mime = match[1]!.toLowerCase()
  if (!EXTENSION_FOR_MIME[mime] && !mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/') && mime !== 'application/pdf') return null
  try {
    const binary = atob(match[2]!)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { mime, bytes }
  } catch {
    return null
  }
}

/** Every distinct embedded image data: URI in `text`. */
export function extractDataImageUris(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set(text.match(DATA_IMAGE_URI) ?? [])]
}

/**
 * A short, distinctive slice of a (possibly very large) data: URI, used to find rows that
 * might contain it with a cheap `instr()` — binding the full multi-hundred-KB URI into
 * every lookup query would be wasteful. A candidate row is then confirmed with a full
 * string match in JS before anything is replaced.
 */
export function needleFor(uri: string): string {
  if (uri.length <= 160) return uri
  const middle = Math.floor(uri.length / 2)
  return uri.slice(middle, middle + 96)
}

function replaceAllLiteral(text: string, from: string, to: string): string {
  return text.split(from).join(to)
}

async function verifyStored(provider: MediaProvider, storageKey: string, url: string): Promise<boolean> {
  if (provider.exists) return provider.exists(storageKey)
  if (!/^https?:\/\//i.test(url)) return false
  try {
    const res = await fetch(url, { method: 'GET' })
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

async function requireRealProvider(event: H3Event): Promise<MediaProvider> {
  const provider = await getActiveProvider(event)
  if (provider.name === 'local') {
    throw new MigrationUnavailableError('No media storage is connected yet — connect R2 (or another provider in Settings → Media) before moving files out of the database.')
  }
  return provider
}

/**
 * Uploads (unless an earlier, interrupted run already did — `exists()` makes resuming a
 * partially-rewritten file skip straight to the rewrite) and confirms the copy is there.
 */
async function uploadAndVerify(
  provider: MediaProvider,
  siteId: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  storageKey: string,
  originalName: string,
): Promise<{ url: string; storageKey: string; size: number }> {
  let body: BlobPart = bytes
  let size = bytes.byteLength
  if (mime === 'image/svg+xml') {
    // Same sanitization every normal SVG upload gets (upload.post.ts).
    const clean = sanitizeSvg(new TextDecoder().decode(bytes))
    body = clean
    size = new TextEncoder().encode(clean).byteLength
  }

  if (provider.exists && await provider.exists(storageKey)) {
    return { url: provider.getUrl(storageKey), storageKey, size }
  }

  const file = new File([body], originalName, { type: mime })
  const uploaded = await provider.upload(file, storageKey, siteId)
  if (!(await verifyStored(provider, uploaded.storageKey, uploaded.url))) {
    throw new Error('The file was uploaded but could not be read back from storage — check the provider settings (for R2, the public URL in Settings → Media).')
  }
  return { url: uploaded.url, storageKey: uploaded.storageKey, size }
}

interface RewriteSummary {
  contentSlugs: string[]
  touchedSettings: boolean
}

interface RewriteResult {
  /** False when the budget ran out first — call again to finish (rewritten rows no longer match). */
  complete: boolean
  summary: RewriteSummary
}

/**
 * Walks every row matching a cheap id-only lookup, rewriting each one individually.
 * `findIds` must return ids in ascending order after `afterId`; `rewriteOne` loads a
 * single row, swaps the URI, and saves it.
 */
async function rewriteRowByRow(
  budget: WorkBudget,
  findIds: (afterId: string | null) => Promise<string[]>,
  rewriteOne: (id: string) => Promise<void>,
): Promise<boolean> {
  let after: string | null = null
  for (;;) {
    if (budget.exhausted) return false
    const ids = await findIds(after)
    budget.spend()
    if (ids.length === 0) return true
    for (const id of ids) {
      if (budget.exhausted) return false
      await rewriteOne(id)
      budget.spend(2)
      after = id
    }
    if (ids.length < ID_PAGE_SIZE) return true
  }
}

/**
 * Replaces every occurrence of `oldUri` with `newUrl` across the site's stored data:
 * content items (body, og image, settings), their revisions, menus, themes, site
 * settings, and the avatars of this site's users. Values are read and written as raw
 * text, so JSON columns keep their exact structure — and one row at a time (see the
 * module doc for why).
 */
export async function rewriteReferences(
  event: H3Event,
  siteId: string,
  oldUri: string,
  newUrl: string,
  budget: WorkBudget = new WorkBudget(),
): Promise<RewriteResult> {
  const db = useDb(event)
  const needle = needleFor(oldUri)
  const summary: RewriteSummary = { contentSlugs: [], touchedSettings: false }
  const swap = (value: string | null) => (value && value.includes(oldUri) ? replaceAllLiteral(value, oldUri, newUrl) : value)
  const done = (complete: boolean): RewriteResult => ({ complete, summary })

  // Content items — body, og:image, and per-item settings.
  const itemsDone = await rewriteRowByRow(
    budget,
    async after => (await db.select({ id: contentItems.id }).from(contentItems).where(and(
      eq(contentItems.siteId, siteId),
      after ? gt(contentItems.id, after) : undefined,
      or(
        sql`instr(${contentItems.content}, ${needle}) > 0`,
        sql`instr(${contentItems.ogImage}, ${needle}) > 0`,
        sql`instr(${contentItems.settings}, ${needle}) > 0`,
      ),
    )).orderBy(asc(contentItems.id)).limit(ID_PAGE_SIZE)).map(r => r.id),
    async (id) => {
      const [item] = await db.select({
        slug: contentItems.slug,
        status: contentItems.status,
        content: sql<string | null>`CAST(${contentItems.content} AS TEXT)`,
        ogImage: contentItems.ogImage,
        settings: sql<string | null>`CAST(${contentItems.settings} AS TEXT)`,
      }).from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))
      if (!item) return
      const content = swap(item.content)
      const ogImage = swap(item.ogImage)
      const settings = swap(item.settings)
      if (content === item.content && ogImage === item.ogImage && settings === item.settings) return
      await db.update(contentItems).set({
        // Raw text bound as-is — these are JSON columns, and passing a parsed object back
        // would re-serialize it; the swap above only ever replaced one opaque string.
        ...(content !== item.content ? { content: sql`${content}` } : {}),
        ...(settings !== item.settings ? { settings: sql`${settings}` } : {}),
        ...(ogImage !== item.ogImage ? { ogImage } : {}),
        // An editor with this item open would otherwise autosave the old inline copy
        // straight back; a version bump makes an optimistic-locked save notice the change.
        version: sql`${contentItems.version} + 1`,
      }).where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))
      if (item.status === 'published') summary.contentSlugs.push(item.slug)
    },
  )
  if (!itemsDone) return done(false)

  // Revisions (history) — so restoring an old revision doesn't bring the inline copy back.
  const siteItemIds = db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.siteId, siteId))
  const revisionsDone = await rewriteRowByRow(
    budget,
    async after => (await db.select({ id: contentRevisions.id }).from(contentRevisions).where(and(
      inArray(contentRevisions.itemId, siteItemIds),
      after ? gt(contentRevisions.id, after) : undefined,
      sql`instr(${contentRevisions.content}, ${needle}) > 0`,
    )).orderBy(asc(contentRevisions.id)).limit(ID_PAGE_SIZE)).map(r => r.id),
    async (id) => {
      const [rev] = await db.select({ content: sql<string | null>`CAST(${contentRevisions.content} AS TEXT)` })
        .from(contentRevisions).where(eq(contentRevisions.id, id))
      const content = rev ? swap(rev.content) : null
      if (rev && content !== rev.content) {
        await db.update(contentRevisions).set({ content: sql`${content}` }).where(eq(contentRevisions.id, id))
      }
    },
  )
  if (!revisionsDone) return done(false)

  // Menus and theme settings (plain JSON text, site-scoped).
  const menusDone = await rewriteRowByRow(
    budget,
    async after => (await db.select({ id: menus.id }).from(menus).where(and(
      eq(menus.siteId, siteId),
      after ? gt(menus.id, after) : undefined,
      sql`instr(${menus.items}, ${needle}) > 0`,
    )).orderBy(asc(menus.id)).limit(ID_PAGE_SIZE)).map(r => r.id),
    async (id) => {
      const [row] = await db.select({ items: sql<string>`CAST(${menus.items} AS TEXT)` }).from(menus).where(eq(menus.id, id))
      const next = row ? swap(row.items) : null
      if (row && next !== row.items) await db.update(menus).set({ items: sql`${next}` }).where(eq(menus.id, id))
    },
  )
  if (!menusDone) return done(false)

  const themesDone = await rewriteRowByRow(
    budget,
    async after => (await db.select({ id: themes.id }).from(themes).where(and(
      eq(themes.siteId, siteId),
      after ? gt(themes.id, after) : undefined,
      sql`instr(${themes.settings}, ${needle}) > 0`,
    )).orderBy(asc(themes.id)).limit(ID_PAGE_SIZE)).map(r => r.id),
    async (id) => {
      const [row] = await db.select({ settings: sql<string | null>`CAST(${themes.settings} AS TEXT)` }).from(themes).where(eq(themes.id, id))
      const next = row ? swap(row.settings) : null
      if (row && next !== row.settings) await db.update(themes).set({ settings: sql`${next}` }).where(eq(themes.id, id))
    },
  )
  if (!themesDone) return done(false)

  // Site settings (logo, favicon, default share image, ...) — written back through
  // saveSetting() so its isolate/KV caches are invalidated like any other settings save.
  const settingsDone = await rewriteRowByRow(
    budget,
    async after => (await db.select({ id: siteSettings.id }).from(siteSettings).where(and(
      eq(siteSettings.siteId, siteId),
      after ? gt(siteSettings.id, after) : undefined,
      sql`instr(${siteSettings.value}, ${needle}) > 0`,
    )).orderBy(asc(siteSettings.id)).limit(ID_PAGE_SIZE)).map(r => r.id),
    async (id) => {
      const [row] = await db.select({ key: siteSettings.key, value: sql<string | null>`CAST(${siteSettings.value} AS TEXT)` })
        .from(siteSettings).where(and(eq(siteSettings.id, id), eq(siteSettings.siteId, siteId)))
      if (!row) return
      const next = swap(row.value)
      if (next === row.value || next === null) return
      let parsed: unknown = next
      try {
        parsed = JSON.parse(next)
      } catch { /* stored as a bare string */ }
      await saveSetting(event, row.key, parsed)
      summary.touchedSettings = true
    },
  )
  if (!settingsDone) return done(false)

  // Avatars — only for accounts that belong to this site, and only an exact match.
  await db.update(users).set({ image: newUrl }).where(and(
    eq(users.image, oldUri),
    inArray(users.id, db.select({ id: userSiteRoles.userId }).from(userSiteRoles).where(eq(userSiteRoles.siteId, siteId))),
  ))
  budget.spend()

  return done(true)
}

async function purgeAfterRewrite(event: H3Event, siteId: string, summaries: RewriteSummary[]): Promise<void> {
  const anyContent = summaries.some(s => s.contentSlugs.length > 0)
  const anySettings = summaries.some(s => s.touchedSettings)
  if (anyContent || anySettings) {
    // Settings like the logo appear on every page, so any change purges every page.
    await purgeAllPublicPages(event, siteId).catch(() => {})
  }
  if (anySettings) await purgeEdgeCache(event, ['/api/public/site']).catch(() => {})
}

function extensionFor(mime: string, fallbackName?: string | null): string {
  const known = EXTENSION_FOR_MIME[mime]
  if (known) return known
  const fromName = fallbackName?.split('.').pop()
  return fromName && /^[a-z0-9]{1,10}$/i.test(fromName) ? fromName.toLowerCase() : 'bin'
}

/** Phase `media`: media-library rows whose file is stored in D1. */
export async function migrateLocalMediaBatch(
  event: H3Event,
  opts: { cursor?: string | null; limit?: number; budget?: WorkBudget } = {},
): Promise<MigrationBatchResult> {
  const siteId = event.context.siteId as string
  const provider = await requireRealProvider(event)
  const db = useDb(event)
  const budget = opts.budget ?? new WorkBudget()
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 10)

  // Ids and sizes only — the (up to ~700 KB) data URI of each row is loaded one at a time.
  const rows = await db.select({ id: media.id }).from(media).where(and(
    eq(media.siteId, siteId),
    eq(media.storageProvider, 'local'),
    opts.cursor ? gt(media.id, opts.cursor) : undefined,
  )).orderBy(asc(media.id)).limit(limit)
  budget.spend()

  const results: MigrationItemResult[] = []
  const summaries: RewriteSummary[] = []
  let cursor = opts.cursor ?? null
  try {
    for (const { id } of rows) {
      if (budget.exhausted) return { results, nextCursor: cursor, done: false }
      try {
        const [row] = await db.select({ url: media.url, mimeType: media.mimeType, originalName: media.originalName })
          .from(media).where(and(eq(media.id, id), eq(media.siteId, siteId)))
        budget.spend()
        if (!row) {
          cursor = id
          continue
        }
        const decoded = decodeDataUri(row.url)
        if (!decoded) throw new Error('The stored file is not a readable data: URI')
        const mime = row.mimeType?.split(';')[0]?.trim().toLowerCase() || decoded.mime
        const storageKey = `${siteId}/${id}.${extensionFor(mime, row.originalName)}`
        const stored = await uploadAndVerify(provider, siteId, decoded.bytes, mime, storageKey, row.originalName ?? storageKey)
        budget.spend(2)

        const rewrite = await rewriteReferences(event, siteId, row.url, stored.url, budget)
        summaries.push(rewrite.summary)
        // Budget ran out partway through this file's references: leave the media row as
        // it is (still pointing at the database copy, which every not-yet-rewritten
        // reference still uses) and pick this same file up again next request.
        if (!rewrite.complete) return { results, nextCursor: cursor, done: false }

        // Last: this is the write that actually drops the database copy.
        await db.update(media).set({
          url: stored.url,
          storageProvider: provider.name as 'cloudflare' | 'r2' | 's3' | 'bunny',
          storageKey: stored.storageKey,
          filename: stored.storageKey,
          size: stored.size,
        }).where(and(eq(media.id, id), eq(media.siteId, siteId)))
        budget.spend()
        results.push({ id, ok: true, newUrl: stored.url })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
      cursor = id
    }
    return { results, nextCursor: cursor, done: rows.length < limit }
  } finally {
    await purgeAfterRewrite(event, siteId, summaries)
  }
}

// Inline-phase cursors walk content items first (`c:<id>`), then site settings (`s:<id>`).
type InlineTarget = { kind: 'c' | 's'; id: string; texts: (string | null)[] }

async function nextInlineTarget(event: H3Event, siteId: string, cursor: string | null | undefined): Promise<InlineTarget | null> {
  const db = useDb(event)
  if (!cursor || cursor.startsWith('c:')) {
    const after = cursor?.slice(2)
    const [item] = await db.select({
      id: contentItems.id,
      content: sql<string | null>`CAST(${contentItems.content} AS TEXT)`,
      ogImage: contentItems.ogImage,
      settings: sql<string | null>`CAST(${contentItems.settings} AS TEXT)`,
    }).from(contentItems).where(and(
      eq(contentItems.siteId, siteId),
      after ? gt(contentItems.id, after) : undefined,
      or(
        sql`instr(${contentItems.content}, 'data:image/') > 0`,
        like(contentItems.ogImage, 'data:image/%'),
        sql`instr(${contentItems.settings}, 'data:image/') > 0`,
      ),
    )).orderBy(asc(contentItems.id)).limit(1)
    if (item) return { kind: 'c', id: item.id, texts: [item.content, item.ogImage, item.settings] }
    cursor = null
  }
  const afterId = cursor?.startsWith('s:') ? cursor.slice(2) : undefined
  const [setting] = await db.select({ id: siteSettings.id, value: sql<string | null>`CAST(${siteSettings.value} AS TEXT)` })
    .from(siteSettings).where(and(
      eq(siteSettings.siteId, siteId),
      afterId ? gt(siteSettings.id, afterId) : undefined,
      sql`instr(${siteSettings.value}, 'data:image/') > 0`,
    )).orderBy(asc(siteSettings.id)).limit(1)
  return setting ? { kind: 's', id: setting.id, texts: [setting.value] } : null
}

/**
 * A stable media id for an embedded image, derived from its content: a request that runs
 * out of budget partway through rewriting an image's references will see the same image
 * again next time, and must reuse the same media row and storage key rather than create a
 * duplicate. 26 upper-case hex characters — a subset of the ULID alphabet, so these keys
 * get the same long-lived caching as normal uploads (routes/_nuxflow/media/).
 */
async function stableMediaIdFor(uri: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uri))
  return bufferToHex(digest).slice(0, 26).toUpperCase()
}

/** Phase `inline`: images embedded as data: URIs with no media-library row. One item per call. */
export async function migrateInlineImagesBatch(
  event: H3Event,
  userId: string,
  opts: { cursor?: string | null; budget?: WorkBudget } = {},
): Promise<MigrationBatchResult> {
  const siteId = event.context.siteId as string
  const provider = await requireRealProvider(event)
  const db = useDb(event)
  const budget = opts.budget ?? new WorkBudget()

  const target = await nextInlineTarget(event, siteId, opts.cursor)
  budget.spend(2)
  if (!target) return { results: [], nextCursor: null, done: true }

  const uris = [...new Set(target.texts.flatMap(extractDataImageUris))]
  // Drop the loaded row text now — only the (much smaller) extracted URIs are needed.
  target.texts = []

  const results: MigrationItemResult[] = []
  const summaries: RewriteSummary[] = []
  try {
    for (const uri of uris) {
      if (budget.exhausted) return { results, nextCursor: opts.cursor ?? null, done: false }
      const id = await stableMediaIdFor(uri)
      try {
        const decoded = decodeDataUri(uri)
        if (!decoded || !SUPPORTED_IMAGE_TYPES.some(t => decoded.mime === `image/${t}`)) throw new Error('Unsupported embedded image')
        const ext = extensionFor(decoded.mime)
        const storageKey = `${siteId}/${id}.${ext}`
        const stored = await uploadAndVerify(provider, siteId, decoded.bytes, decoded.mime, storageKey, `embedded-image.${ext}`)
        await db.insert(media).values({
          id,
          siteId,
          uploadedBy: userId,
          filename: stored.storageKey,
          originalName: `embedded-image.${ext}`,
          mimeType: decoded.mime,
          size: stored.size,
          url: stored.url,
          storageProvider: provider.name as 'cloudflare' | 'r2' | 's3' | 'bunny',
          storageKey: stored.storageKey,
        }).onConflictDoNothing()
        budget.spend(3)

        const rewrite = await rewriteReferences(event, siteId, uri, stored.url, budget)
        summaries.push(rewrite.summary)
        // Out of budget partway through: come back to this same item next request.
        if (!rewrite.complete) return { results, nextCursor: opts.cursor ?? null, done: false }
        results.push({ id, ok: true, newUrl: stored.url })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { results, nextCursor: `${target.kind}:${target.id}`, done: false }
  } finally {
    await purgeAfterRewrite(event, siteId, summaries)
  }
}

export async function getMigrationStatus(event: H3Event): Promise<MigrationStatus> {
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const provider = await getActiveProvider(event)

  const [[mediaStats], [contentStats], [settingStats]] = await Promise.all([
    db.select({ n: count(), bytes: sql<number>`COALESCE(SUM(LENGTH(${media.url})), 0)` })
      .from(media).where(and(eq(media.siteId, siteId), eq(media.storageProvider, 'local'))),
    db.select({ n: count() }).from(contentItems).where(and(
      eq(contentItems.siteId, siteId),
      or(
        sql`instr(${contentItems.content}, 'data:image/') > 0`,
        like(contentItems.ogImage, 'data:image/%'),
        sql`instr(${contentItems.settings}, 'data:image/') > 0`,
      ),
    )),
    db.select({ n: count() }).from(siteSettings).where(and(
      eq(siteSettings.siteId, siteId),
      sql`instr(${siteSettings.value}, 'data:image/') > 0`,
    )),
  ])

  return {
    provider: provider.name,
    servedByWorker: (provider as { servedByWorker?: boolean }).servedByWorker === true,
    canMigrate: provider.name !== 'local',
    pendingMedia: mediaStats?.n ?? 0,
    pendingMediaBytes: Number(mediaStats?.bytes ?? 0),
    pendingInline: (contentStats?.n ?? 0) + (settingStats?.n ?? 0),
  }
}
