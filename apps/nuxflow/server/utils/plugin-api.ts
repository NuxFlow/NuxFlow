// The host side of every plugin capability — what runs when plugin code calls
// `env.NUXFLOW.<method>()`. Called only from server/plugin-host/entrypoints.ts, whose
// `ctx.props` (site, plugin, granted permissions) are set by this Worker when it spawns the
// plugin and can't be forged or changed by plugin code. So every function here trusts
// `PluginCallContext` and treats every *argument* as hostile input: validated, size-capped,
// and scoped to the calling plugin's own site and id.
import type { H3Event } from 'h3'
import { and, asc, count, eq, gt, isNull, or, sql, sum } from 'drizzle-orm'
import { generateText } from 'ai'
import { ulid } from 'ulid'
import { contentItems, contentTypes, dynamicPlugins, pluginStorage, sites } from '@nuxflow/db/schema'
import { useDb } from './db'
import { withPublicPaths } from './seo'
import { contentToMarkdown } from './markdown'
import { htmlToTipTap, type TTNode } from './html-to-tiptap'
import { uniqueContentSlug } from './content-queries'
import { assertWithinPlan } from './hosting-plans'
import { requireAiSdkModel } from './ai-sdk'
import { notifySiteRole } from './notify'
import { rateLimit } from './rate-limit'
import { buildAuditLogInsert, batchWithAudit } from './audit'
import { parseCapabilitiesText } from './plugin-package'
import { resolvePluginSettings } from './plugin-settings'

export interface PluginCallContext {
  event: H3Event
  siteId: string
  pluginId: string
  permissions: readonly string[]
}

/** An error whose message is meant for the plugin author — it crosses back over RPC. */
export class PluginApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginApiError'
  }
}

function requirePermission(ctx: PluginCallContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) {
    throw new PluginApiError(`This plugin was not granted the "${permission}" permission. Declare it in nuxflow.plugin.json and have an admin approve it.`)
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function optionalString(v: unknown, name: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new PluginApiError(`${name} must be a string`)
  if (v.length > max) throw new PluginApiError(`${name} must be at most ${max} characters`)
  return v
}

function intInRange(v: unknown, name: string, min: number, max: number, fallback: number): number {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new PluginApiError(`${name} must be a whole number from ${min} to ${max}`)
  return v
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** The plugin's own settings (declared in its manifest, filled in by an admin). */
export async function getSettings(ctx: PluginCallContext): Promise<Record<string, unknown>> {
  const row = await useDb(ctx.event).query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.siteId, ctx.siteId), eq(dynamicPlugins.id, ctx.pluginId)),
    columns: { capabilities: true, settingsValues: true },
  })
  if (!row) throw new PluginApiError('Plugin not found')
  return resolvePluginSettings(parseCapabilitiesText(row.capabilities).settings, row.settingsValues ?? null)
}

// ── Storage (`storage`) ───────────────────────────────────────────────────────

export const STORAGE_LIMITS = {
  maxKeyLength: 512,
  maxValueBytes: 128 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxKeys: 10_000,
  maxListLimit: 100,
}

function storageKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) throw new PluginApiError('Storage key must be a non-empty string')
  if (key.length > STORAGE_LIMITS.maxKeyLength) throw new PluginApiError(`Storage key must be at most ${STORAGE_LIMITS.maxKeyLength} characters`)
  return key
}

function storageScope(ctx: PluginCallContext) {
  return and(eq(pluginStorage.siteId, ctx.siteId), eq(pluginStorage.pluginId, ctx.pluginId))
}

const notExpired = or(isNull(pluginStorage.expiresAt), gt(pluginStorage.expiresAt, sql`datetime('now')`))

export async function storageGet(ctx: PluginCallContext, key: unknown): Promise<unknown> {
  requirePermission(ctx, 'storage')
  const row = await useDb(ctx.event).query.pluginStorage.findFirst({
    where: and(storageScope(ctx), eq(pluginStorage.key, storageKey(key)), notExpired),
    columns: { value: true },
  })
  return row ? JSON.parse(row.value) : null
}

export async function storagePut(ctx: PluginCallContext, key: unknown, value: unknown, options?: unknown): Promise<void> {
  requirePermission(ctx, 'storage')
  const k = storageKey(key)
  if (value === undefined) throw new PluginApiError('Storage value must not be undefined — use delete() to remove a key')
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    throw new PluginApiError('Storage value must be JSON-serialisable')
  }
  const size = new TextEncoder().encode(json).byteLength
  if (size > STORAGE_LIMITS.maxValueBytes) throw new PluginApiError(`Storage value is ${size} bytes; the limit is ${STORAGE_LIMITS.maxValueBytes}`)
  const ttl = isRecord(options) ? intInRange(options.ttlSeconds, 'ttlSeconds', 60, 365 * 24 * 3600, 0) : 0

  const db = useDb(ctx.event)
  const [usage] = await db.select({ keys: count(), bytes: sum(pluginStorage.size) })
    .from(pluginStorage)
    .where(and(storageScope(ctx), notExpired, sql`${pluginStorage.key} <> ${k}`))
  if ((usage?.keys ?? 0) >= STORAGE_LIMITS.maxKeys) throw new PluginApiError(`Storage is full (${STORAGE_LIMITS.maxKeys} keys) — delete some keys first`)
  if (Number(usage?.bytes ?? 0) + size > STORAGE_LIMITS.maxTotalBytes) throw new PluginApiError(`Storage is full (${STORAGE_LIMITS.maxTotalBytes / 1024 / 1024} MB) — delete some keys first`)

  const expiresAt = ttl ? sql`datetime('now', ${`+${ttl} seconds`})` : null
  await db.insert(pluginStorage)
    .values({ siteId: ctx.siteId, pluginId: ctx.pluginId, key: k, value: json, size, expiresAt, updatedAt: sql`(datetime('now'))` })
    .onConflictDoUpdate({
      target: [pluginStorage.siteId, pluginStorage.pluginId, pluginStorage.key],
      set: { value: json, size, expiresAt, updatedAt: sql`(datetime('now'))` },
    })
}

export async function storageDelete(ctx: PluginCallContext, key: unknown): Promise<void> {
  requirePermission(ctx, 'storage')
  await useDb(ctx.event).delete(pluginStorage).where(and(storageScope(ctx), eq(pluginStorage.key, storageKey(key))))
}

export async function storageList(ctx: PluginCallContext, options?: unknown): Promise<{ keys: { key: string, size: number, expiresAt: string | null }[], cursor: string | null }> {
  requirePermission(ctx, 'storage')
  const opts = isRecord(options) ? options : {}
  const prefix = optionalString(opts.prefix, 'prefix', STORAGE_LIMITS.maxKeyLength) ?? ''
  const cursor = optionalString(opts.cursor, 'cursor', STORAGE_LIMITS.maxKeyLength)
  const limit = intInRange(opts.limit, 'limit', 1, STORAGE_LIMITS.maxListLimit, STORAGE_LIMITS.maxListLimit)
  const rows = await useDb(ctx.event).select({ key: pluginStorage.key, size: pluginStorage.size, expiresAt: pluginStorage.expiresAt })
    .from(pluginStorage)
    .where(and(
      storageScope(ctx),
      notExpired,
      // substr() rather than LIKE: LIKE is case-insensitive and treats % and _ as wildcards.
      prefix ? sql`substr(${pluginStorage.key}, 1, ${prefix.length}) = ${prefix}` : undefined,
      cursor ? gt(pluginStorage.key, cursor) : undefined,
    ))
    .orderBy(asc(pluginStorage.key))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  return { keys: page, cursor: rows.length > limit ? page[page.length - 1]!.key : null }
}

// ── Content (`content:read`, `content:write`) ─────────────────────────────────

const PUBLIC_ITEM_COLUMNS = {
  id: contentItems.id,
  title: contentItems.title,
  slug: contentItems.slug,
  locale: contentItems.locale,
  sourceItemId: contentItems.sourceItemId,
  excerpt: contentItems.excerpt,
  seoTitle: contentItems.seoTitle,
  seoDescription: contentItems.seoDescription,
  ogImage: contentItems.ogImage,
  publishedAt: contentItems.publishedAt,
  updatedAt: contentItems.updatedAt,
  type: contentTypes.slug,
}

// Only what any visitor can already see: published, public items.
function publicScope(siteId: string) {
  return and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public'))
}

export async function listContent(ctx: PluginCallContext, options?: unknown) {
  requirePermission(ctx, 'content:read')
  const opts = isRecord(options) ? options : {}
  const type = optionalString(opts.type, 'type', 100)
  const locale = optionalString(opts.locale, 'locale', 10)
  const limit = intInRange(opts.limit, 'limit', 1, 50, 20)
  const offset = intInRange(opts.offset, 'offset', 0, 10_000, 0)
  const rows = await useDb(ctx.event).select(PUBLIC_ITEM_COLUMNS)
    .from(contentItems)
    .innerJoin(contentTypes, eq(contentTypes.id, contentItems.typeId))
    .where(and(
      publicScope(ctx.siteId),
      type ? eq(contentTypes.slug, type) : undefined,
      locale ? eq(contentItems.locale, locale) : undefined,
    ))
    .orderBy(sql`${contentItems.publishedAt} DESC`, asc(contentItems.id))
    .limit(limit)
    .offset(offset)
  return { items: await withPublicPaths(useDb(ctx.event), ctx.siteId, rows) }
}

export async function getContent(ctx: PluginCallContext, options?: unknown) {
  requirePermission(ctx, 'content:read')
  const opts = isRecord(options) ? options : {}
  const id = optionalString(opts.id, 'id', 100)
  const slug = optionalString(opts.slug, 'slug', 500)
  if (!id === !slug) throw new PluginApiError('Pass exactly one of id or slug')
  const [row] = await useDb(ctx.event).select({ ...PUBLIC_ITEM_COLUMNS, content: contentItems.content })
    .from(contentItems)
    .innerJoin(contentTypes, eq(contentTypes.id, contentItems.typeId))
    .where(and(publicScope(ctx.siteId), id ? eq(contentItems.id, id) : eq(contentItems.slug, slug!)))
    .limit(1)
  if (!row) return null
  const { content, ...meta } = row
  const [withPath] = await withPublicPaths(useDb(ctx.event), ctx.siteId, [meta])
  return { ...withPath, content, markdown: contentToMarkdown(content) }
}

// A plugin's HTML can carry remote images; an editor opening the draft would load them,
// handing the image host their IP and the fact the draft was opened. Plugins can't upload
// media, so image nodes are dropped rather than proxied.
function withoutImages(nodes: TTNode[]): TTNode[] {
  return nodes
    .filter(n => n.type !== 'image')
    .map(n => (n.content ? { ...n, content: withoutImages(n.content) } : n))
}

export async function createDraft(ctx: PluginCallContext, input: unknown): Promise<{ id: string, slug: string }> {
  requirePermission(ctx, 'content:write')
  if (!isRecord(input)) throw new PluginApiError('createDraft expects an object')
  const title = optionalString(input.title, 'title', 500)?.trim()
  if (!title) throw new PluginApiError('title is required')
  const typeSlug = optionalString(input.type, 'type', 100) ?? 'post'
  const html = optionalString(input.html, 'html', 500_000) ?? ''
  const excerpt = optionalString(input.excerpt, 'excerpt', 2000)
  const seoTitle = optionalString(input.seoTitle, 'seoTitle', 200)
  const seoDescription = optionalString(input.seoDescription, 'seoDescription', 500)
  const wantedSlug = optionalString(input.slug, 'slug', 200)

  const db = useDb(ctx.event)
  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, ctx.siteId), eq(contentTypes.slug, typeSlug)),
    columns: { id: true },
  })
  if (!type) throw new PluginApiError(`This site has no content type "${typeSlug}"`)
  await assertWithinPlan(ctx.event, 'content')

  const body = withoutImages(htmlToTipTap(html).content)
  const site = await db.query.sites.findFirst({ where: eq(sites.id, ctx.siteId), columns: { locale: true } })
  const id = ulid()
  const slug = await uniqueContentSlug(db, ctx.siteId, wantedSlug || title)
  const insert = db.insert(contentItems).values({
    id,
    siteId: ctx.siteId,
    typeId: type.id,
    authorId: null,
    title,
    slug,
    // Always a draft: publishing stays a person's decision.
    status: 'draft',
    visibility: 'public',
    content: { type: 'doc', content: body.length ? body : [{ type: 'paragraph' }] },
    excerpt: excerpt ?? null,
    seoTitle: seoTitle ?? null,
    seoDescription: seoDescription ?? null,
    locale: site?.locale || 'en',
  })
  const audit = buildAuditLogInsert(ctx.event, null, { action: 'create', resource: 'content_item', resourceId: id, after: { title, slug, status: 'draft', createdByPlugin: ctx.pluginId } })
  await batchWithAudit(db, [insert], audit)
  return { id, slug }
}

// ── AI (`ai`) ─────────────────────────────────────────────────────────────────

export async function aiGenerateText(ctx: PluginCallContext, input: unknown): Promise<{ text: string }> {
  requirePermission(ctx, 'ai')
  if (!isRecord(input)) throw new PluginApiError('generateText expects an object')
  const prompt = optionalString(input.prompt, 'prompt', 20_000)
  if (!prompt?.trim()) throw new PluginApiError('prompt is required')
  const system = optionalString(input.system, 'system', 5000)
  const maxOutputTokens = intInRange(input.maxOutputTokens, 'maxOutputTokens', 1, 4000, 1000)
  await rateLimit(ctx.event, { limit: 30, windowMs: 60_000, keyPrefix: `plugin-ai:${ctx.pluginId}` })
  // requireAiSdkModel checks the hosting-plan AI limit, and the model it returns counts
  // each call towards the site's usage like every other AI feature. Plugin routes are
  // public, so anyone can set these calls off: they use the visitor AI allowance, never
  // the team's.
  const model = await requireAiSdkModel(ctx.event, 'fast', { trigger: 'visitor' })
  const result = await generateText({ model, prompt, ...(system ? { system } : {}), maxOutputTokens })
  return { text: result.text }
}

// ── Notifications (`notify`) ──────────────────────────────────────────────────

export async function notifyAdmins(ctx: PluginCallContext, input: unknown): Promise<{ sent: number }> {
  requirePermission(ctx, 'notify')
  if (!isRecord(input)) throw new PluginApiError('notifyAdmins expects an object')
  const title = optionalString(input.title, 'title', 200)?.trim()
  const body = optionalString(input.body, 'body', 2000)?.trim()
  if (!title || !body) throw new PluginApiError('title and body are required')
  const url = optionalString(input.url, 'url', 500)
  // Only a path on this site — a notification is a trusted surface, so it can't send an
  // admin to an outside address.
  if (url && (!url.startsWith('/') || url.startsWith('//') || url.includes('\\'))) {
    throw new PluginApiError('url must be a path on this site, starting with /')
  }
  await rateLimit(ctx.event, { limit: 20, windowMs: 3_600_000, keyPrefix: `plugin-notify:${ctx.pluginId}` })
  const plugin = await useDb(ctx.event).query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.siteId, ctx.siteId), eq(dynamicPlugins.id, ctx.pluginId)),
    columns: { name: true },
  })
  const sent = await notifySiteRole(ctx.event, {
    siteId: ctx.siteId,
    minRole: 'admin',
    type: 'system.plugin_message',
    title: `${plugin?.name ?? ctx.pluginId}: ${title}`,
    body,
    sendEmailNotification: false,
    ...(url ? { pushUrl: url } : {}),
  })
  return { sent }
}

/** Dispatch table used by the RPC entrypoint — one name per method plugins can call. */
export const PLUGIN_API_METHODS = {
  getSettings: (ctx: PluginCallContext) => getSettings(ctx),
  storageGet: (ctx: PluginCallContext, key: unknown) => storageGet(ctx, key),
  storagePut: (ctx: PluginCallContext, key: unknown, value: unknown, options?: unknown) => storagePut(ctx, key, value, options),
  storageDelete: (ctx: PluginCallContext, key: unknown) => storageDelete(ctx, key),
  storageList: (ctx: PluginCallContext, options?: unknown) => storageList(ctx, options),
  listContent: (ctx: PluginCallContext, options?: unknown) => listContent(ctx, options),
  getContent: (ctx: PluginCallContext, options?: unknown) => getContent(ctx, options),
  createDraft: (ctx: PluginCallContext, input: unknown) => createDraft(ctx, input),
  generateText: (ctx: PluginCallContext, input: unknown) => aiGenerateText(ctx, input),
  notifyAdmins: (ctx: PluginCallContext, input: unknown) => notifyAdmins(ctx, input),
}
