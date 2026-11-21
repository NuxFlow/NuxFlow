import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, like, ne, sql, type SQL } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, forms, formSubmissions, media, menus, redirects } from '@nuxflow/db/schema'
import { batchWithAudit, buildAuditLogInsert, writeAuditLog } from './audit'
import { scopedById } from './db-helpers'
import { getActiveProvider } from './media-providers/index'
import { MAX_MEDIA_UPLOAD_BYTES, bareMimeType, storeMediaFile } from './media-upload'
import { MENU_LOCATIONS, menuItemsSchema, purgeMenuLocations } from './menus'
import { redirectRuleSchema, saveRedirect } from './redirects'
import { clearRedirectCache } from './redirect-cache'
import { publicSubmissionData } from './form-files'
import { safeFetch } from './ssrf'
import { errorMessage } from './errors'
import { base64ToBytes } from '../../shared/lib/base64'
import { toolJsonResult, parseToolArgs, toolRoleError, textResult, type McpToolContext, type McpToolDefinition, type McpToolResult } from './mcp-common'

// MCP tools for the rest of a site beyond its content (mcp-tools.ts): the media library,
// menus, redirects and form submissions. Each mirrors its admin REST route's role floor,
// validation, audit entry and cache purge — a key can never do more here than its owner
// could in the admin. As in mcp-tools.ts, each Zod schema sits next to the JSON Schema
// advertised for it: **change both together**.

const LIMIT_MAX = 50

const pageArgs = {
  limit: z.coerce.number().int().positive().max(LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}
const PAGE_PROPERTIES = {
  limit: { type: 'number', description: `How many to return (default 20, at most ${LIMIT_MAX})` },
  offset: { type: 'number', description: 'How many to skip, for the next page of results' },
}

// ── Media ─────────────────────────────────────────────────────────────────────

const MEDIA_KINDS = { image: 'image/%', video: 'video/%', audio: 'audio/%', pdf: 'application/pdf' } as const

const listMediaArgs = z.object({
  query: z.string().trim().max(200).optional(),
  kind: z.enum(['image', 'video', 'audio', 'pdf']).optional(),
  folder: z.string().max(100).optional(),
  missingAltText: z.boolean().optional(),
  ...pageArgs,
})

const updateMediaArgs = z.object({
  id: z.string().min(1),
  altText: z.string().max(500).nullable().optional(),
  caption: z.string().max(1000).nullable().optional(),
  focalX: z.number().int().min(0).max(100).nullable().optional(),
  focalY: z.number().int().min(0).max(100).nullable().optional(),
})

// Inline bytes are for small files an assistant already has (a screenshot, a generated
// image); anything bigger goes by URL, so a JSON-RPC body never carries 20 MB of base64.
const INLINE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

const uploadMediaArgs = z.object({
  url: z.string().trim().url().max(2048).optional(),
  dataBase64: z.string().max(Math.ceil(INLINE_UPLOAD_MAX_BYTES * 4 / 3) + 4).optional(),
  mimeType: z.string().max(100).optional(),
  filename: z.string().trim().min(1).max(200).optional(),
  altText: z.string().max(500).optional(),
}).refine(a => Boolean(a.url) !== Boolean(a.dataBase64), { message: 'Give either url or dataBase64, not both' })

// ── Menus ─────────────────────────────────────────────────────────────────────

// Assistants describe a link as { label, page: "<slug>" } or { label, url }; the tool
// turns pages into the stored { type: 'page', contentId, slug } shape the admin writes.
const mcpMenuLink = z.object({
  label: z.string().trim().min(1).max(200),
  page: z.string().trim().min(1).max(500).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  newTab: z.boolean().optional(),
}).refine(l => Boolean(l.page) !== Boolean(l.url), { message: 'Each link needs either page (a content slug) or url, not both' })

const mcpMenuItems = z.array(mcpMenuLink.and(z.object({ children: z.array(mcpMenuLink).max(50).optional() }))).max(50)

const createMenuArgs = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.enum(MENU_LOCATIONS).nullish(),
  items: mcpMenuItems.optional(),
})

const updateMenuArgs = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
  location: z.enum(MENU_LOCATIONS).nullish(),
  items: mcpMenuItems.optional(),
})

const idArgs = z.object({ id: z.string().min(1) })

const MENU_LINK_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'The text shown in the menu' },
    page: { type: 'string', description: 'Link to one of this site\'s pages or posts, by its slug (see list_content). Give page or url.' },
    url: { type: 'string', description: 'Any other link: a site path like "/blog" or a full https:// address' },
    newTab: { type: 'boolean', description: 'Open in a new tab' },
  },
  required: ['label'],
}

const MENU_ITEMS_SCHEMA = {
  type: 'array',
  description: 'The whole menu, in order — replaces what is there. Each top-level link may have children (one level only).',
  items: { ...MENU_LINK_SCHEMA, properties: { ...MENU_LINK_SCHEMA.properties, children: { type: 'array', items: MENU_LINK_SCHEMA } } },
}

// ── Redirects ─────────────────────────────────────────────────────────────────

const listRedirectsArgs = z.object({ query: z.string().trim().max(200).optional(), ...pageArgs })

// ── Forms ─────────────────────────────────────────────────────────────────────

const SUBMISSION_FILTERS = {
  inbox: ['new', 'read'],
  new: ['new'],
  read: ['read'],
  archived: ['archived'],
  spam: ['spam'],
} as const

const listSubmissionsArgs = z.object({
  form: z.string().trim().min(1).max(200),
  status: z.enum(['inbox', 'new', 'read', 'archived', 'spam', 'all']).default('inbox'),
  ...pageArgs,
})

export const MCP_SITE_TOOLS: Record<string, McpToolDefinition> = {
  list_media: {
    description: 'List files in the media library (newest first), with their URL, size and alt text. Use the URL to put an image in a page or post.',
    scope: 'read:content',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Only files whose name contains this' },
        kind: { type: 'string', enum: ['image', 'video', 'audio', 'pdf'] },
        folder: { type: 'string', description: 'A folder id, or "none" for files outside any folder' },
        missingAltText: { type: 'boolean', description: 'Only images with no alt text — for an accessibility pass' },
        ...PAGE_PROPERTIES,
      },
    },
  },
  update_media: {
    description: 'Set a media file\'s alt text (describe what the image shows, for people using screen readers), caption, or focal point (0–100 from the left/top, the part kept when the image is cropped). Pass null to clear a value.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The media file\'s id from list_media' },
        altText: { type: ['string', 'null'] },
        caption: { type: ['string', 'null'] },
        focalX: { type: ['number', 'null'] },
        focalY: { type: ['number', 'null'] },
      },
      required: ['id'],
    },
  },
  upload_media: {
    description: `Add a file to the media library, from a public URL (up to 20 MB) or as base64 (up to 5 MB). Images, video, audio and PDF only. Returns its id and URL. Only upload files the person has the right to use.`,
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A public http(s) address to download the file from' },
        dataBase64: { type: 'string', description: 'The file\'s bytes, base64-encoded (instead of url)' },
        mimeType: { type: 'string', description: 'With dataBase64: the file type, e.g. "image/png"' },
        filename: { type: 'string', description: 'The name to give it, e.g. "team-photo.jpg"' },
        altText: { type: 'string', description: 'Alt text for an image' },
      },
    },
  },
  list_menus: {
    description: 'List the site\'s menus with their links. location says where a menu shows: header, footer or sidebar (none = not shown yet).',
    scope: 'read:content',
    inputSchema: { type: 'object', properties: {} },
  },
  create_menu: {
    description: 'Create a menu, optionally with its links and a location. A location already used by another menu is taken over by this one on the live site, so check list_menus first.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        location: { type: ['string', 'null'], enum: [...MENU_LOCATIONS, null] },
        items: MENU_ITEMS_SCHEMA,
      },
      required: ['name'],
    },
  },
  update_menu: {
    description: 'Rename a menu, move it to another location, or replace its links. Changes to the header or footer menu show on every page at once, so show the person the new menu first.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        location: { type: ['string', 'null'], enum: [...MENU_LOCATIONS, null], description: 'null takes it off the site without deleting it' },
        items: MENU_ITEMS_SCHEMA,
      },
      required: ['id'],
    },
  },
  delete_menu: {
    description: 'Delete a menu.',
    scope: 'write:content',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  list_redirects: {
    description: 'List the site\'s redirects (old address → new address).',
    scope: 'read:content',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Only rules whose from or to address contains this' }, ...PAGE_PROPERTIES },
    },
  },
  create_redirect: {
    description: 'Send visitors and search engines from an old address to a new one. 301 = moved for good (the usual choice), 302/307 = temporary, 308 = moved for good keeping the request method, 410 = gone for good (no destination). Existing redirects to the old address are pointed straight at the new one.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'The old site path, starting with /' },
        to: { type: 'string', description: 'A site path starting with / or a full http(s) address. Leave out for 410.' },
        statusCode: { type: 'number', enum: [301, 302, 307, 308, 410], description: 'Default 301' },
      },
      required: ['from'],
    },
  },
  delete_redirect: {
    description: 'Delete a redirect.',
    scope: 'write:content',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  list_forms: {
    description: 'List the site\'s forms with how many submissions each has (spam not counted) and how many are new.',
    scope: 'read:personal',
    inputSchema: { type: 'object', properties: {} },
  },
  list_form_submissions: {
    description: 'Read what people sent through a form, newest first. This is personal data: use it only for what the person asked, and don\'t repeat it anywhere else. Uploaded files are listed by name only.',
    scope: 'read:personal',
    inputSchema: {
      type: 'object',
      properties: {
        form: { type: 'string', description: 'The form\'s slug (e.g. "contact") or id, from list_forms' },
        status: { type: 'string', enum: ['inbox', 'new', 'read', 'archived', 'spam', 'all'], description: 'inbox (default) = new and read, leaving out spam and archived' },
        ...PAGE_PROPERTIES,
      },
      required: ['form'],
    },
  },
}

// ── Media ─────────────────────────────────────────────────────────────────────

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, c => `\\${c}`)
}

async function listMedia(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const p = parseToolArgs(listMediaArgs, args)
  if ('error' in p) return p.error
  const { query, kind, folder, missingAltText } = p.data
  const conditions: SQL[] = [eq(media.siteId, ctx.siteId)]
  if (query) conditions.push(sql`${media.originalName} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`)
  if (kind) conditions.push(kind === 'pdf' ? eq(media.mimeType, MEDIA_KINDS.pdf) : like(media.mimeType, MEDIA_KINDS[kind]))
  if (folder) conditions.push(folder === 'none' ? isNull(media.folderId) : eq(media.folderId, folder))
  if (missingAltText) {
    conditions.push(like(media.mimeType, 'image/%'))
    conditions.push(sql`coalesce(trim(${media.altText}), '') = ''`)
  }
  const files = await ctx.db.query.media.findMany({
    where: and(...conditions),
    orderBy: [desc(media.createdAt), desc(media.id)],
    limit: p.data.limit ?? 20,
    offset: p.data.offset ?? 0,
    columns: { id: true, originalName: true, mimeType: true, size: true, width: true, height: true, url: true, altText: true, caption: true, focalX: true, focalY: true, folderId: true, createdAt: true },
  })
  // A data: URL (pre-storage builds) is useless to an assistant and can be huge.
  return toolJsonResult(files.map(f => ({ ...f, url: f.url.startsWith('data:') ? '(stored in the database — move it to file storage in Settings → Media)' : f.url })))
}

async function updateMedia(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'author', 'edit media')
  if (denied) return denied
  const p = parseToolArgs(updateMediaArgs, args)
  if ('error' in p) return p.error
  const { id, ...changes } = p.data
  if (!Object.keys(changes).length) return textResult('Error: Nothing to change — give altText, caption, focalX or focalY.')
  const existing = await ctx.db.query.media.findFirst({
    where: and(eq(media.id, id), eq(media.siteId, ctx.siteId)),
    columns: { altText: true, caption: true, focalX: true, focalY: true },
  })
  if (!existing) return textResult(`Error: Media file "${id}" not found.`)
  const update = ctx.db.update(media).set(changes).where(scopedById(media.id, id, media.siteId, ctx.siteId))
  await batchWithAudit(ctx.db, [update], buildAuditLogInsert(ctx.event, ctx.apiKeyUserId, {
    action: 'update', resource: 'media', resourceId: id, before: existing, after: changes,
  }))
  return textResult(`Success: Media file ${id} updated.`)
}

const EXT_FOR_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
  'audio/ogg': 'ogg', 'application/pdf': 'pdf',
}

function fileName(requested: string | undefined, fromUrl: string | undefined, type: string): string {
  let name = requested ?? ''
  if (!name && fromUrl) {
    try { name = decodeURIComponent(new URL(fromUrl).pathname.split('/').pop() ?? '') } catch { name = '' }
  }
  name = name.replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 200) || 'upload'
  const ext = EXT_FOR_TYPE[type]
  return ext && !/\.[a-z0-9]{1,10}$/i.test(name) ? `${name}.${ext}` : name
}

/** Downloads `url` (SSRF-guarded, redirects re-checked) without buffering past the cap. */
async function downloadFile(url: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok || !res.body) throw new Error(`The file couldn't be downloaded (HTTP ${res.status}).`)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_MEDIA_UPLOAD_BYTES) {
    await res.body.cancel()
    throw new Error('The file is larger than 20 MB.')
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_MEDIA_UPLOAD_BYTES) {
      await reader.cancel()
      throw new Error('The file is larger than 20 MB.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }
  return { bytes, type: bareMimeType(res.headers.get('content-type') ?? '') }
}

async function uploadMedia(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'author', 'upload media')
  if (denied) return denied
  const p = parseToolArgs(uploadMediaArgs, args)
  if ('error' in p) return p.error
  // Refuse before downloading anything when the site has no file storage (409 storage_required).
  const provider = await getActiveProvider(ctx.event)

  let bytes: Uint8Array<ArrayBuffer>
  let type: string
  if (p.data.url) {
    try {
      ;({ bytes, type } = await downloadFile(p.data.url))
    } catch (err) {
      return textResult(`Error: ${errorMessage(err, 'The file couldn\'t be downloaded.')}`)
    }
  } else {
    try {
      bytes = base64ToBytes(p.data.dataBase64!.replace(/^data:[^,]*,/, ''))
    } catch {
      return textResult('Error: dataBase64 isn\'t valid base64.')
    }
    if (bytes.byteLength > INLINE_UPLOAD_MAX_BYTES) return textResult('Error: Inline uploads are limited to 5 MB — give a url instead.')
    type = bareMimeType(p.data.mimeType ?? '')
  }
  if (!type) return textResult('Error: The file type is unknown — pass mimeType.')

  const file = new File([bytes], fileName(p.data.filename, p.data.url, type), { type })
  const stored = await storeMediaFile(ctx.event, provider, { file, userId: ctx.apiKeyUserId, siteId: ctx.siteId, altText: p.data.altText ?? null })
  return toolJsonResult({ ...stored, name: file.name, mimeType: type, size: file.size })
}

// ── Menus ─────────────────────────────────────────────────────────────────────

type McpMenuItems = z.infer<typeof mcpMenuItems>
type StoredMenuItems = z.infer<typeof menuItemsSchema>

/** Turns assistant-shaped links into the stored shape, resolving `page` slugs on this site. */
async function toStoredMenuItems(ctx: McpToolContext, items: McpMenuItems): Promise<{ items: StoredMenuItems } | { error: string }> {
  const slugs = [...new Set(items.flatMap(i => [i, ...(i.children ?? [])]).map(l => l.page).filter((s): s is string => Boolean(s)))]
  const pages = slugs.length
    ? await ctx.db.select({ id: contentItems.id, slug: contentItems.slug })
        .from(contentItems)
        .where(and(eq(contentItems.siteId, ctx.siteId), inArray(contentItems.slug, slugs)))
    : []
  const idBySlug = new Map(pages.map(p => [p.slug, p.id]))
  const missing = slugs.filter(s => !idBySlug.has(s))
  if (missing.length) return { error: `No page or post with slug ${missing.map(s => `"${s}"`).join(', ')}. Use list_content to find slugs.` }

  const badUrl = items.flatMap(i => [i, ...(i.children ?? [])]).find(l => l.url && !l.url.startsWith('/') && !/^https?:\/\//i.test(l.url) && !/^mailto:|^tel:/i.test(l.url))
  if (badUrl) return { error: `"${badUrl.url}" isn't a link — use a site path starting with /, or a full https:// address.` }

  const link = (l: z.infer<typeof mcpMenuLink>) => ({
    id: ulid(),
    label: l.label,
    target: l.newTab ? '_blank' as const : '_self' as const,
    ...(l.page
      ? { type: 'page' as const, contentId: idBySlug.get(l.page)!, slug: l.page }
      : { type: 'url' as const, url: l.url! }),
  })
  return { items: items.map(i => ({ ...link(i), children: (i.children ?? []).map(link) })) }
}

/** Stored links back in the shape assistants write them in. */
function describeMenuItems(raw: unknown[]): unknown[] {
  const parsed = menuItemsSchema.safeParse(raw)
  if (!parsed.success) return raw
  const link = (l: StoredMenuItems[number] | StoredMenuItems[number]['children'][number]) => ({
    label: l.label,
    ...(l.type === 'url' || (!l.slug && l.url) ? { url: l.url ?? '' } : { page: l.slug ?? '' }),
    ...(l.target === '_blank' ? { newTab: true } : {}),
  })
  return parsed.data.map(i => ({ ...link(i), ...(i.children.length ? { children: i.children.map(link) } : {}) }))
}

async function listMenus(_args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const rows = await ctx.db.query.menus.findMany({
    where: eq(menus.siteId, ctx.siteId),
    orderBy: [asc(menus.name)],
    columns: { id: true, name: true, location: true, items: true, updatedAt: true },
  })
  return toolJsonResult(rows.map(r => ({ ...r, items: describeMenuItems(r.items) })))
}

async function createMenu(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'change menus')
  if (denied) return denied
  const p = parseToolArgs(createMenuArgs, args)
  if ('error' in p) return p.error
  const converted = p.data.items ? await toStoredMenuItems(ctx, p.data.items) : { items: [] }
  if ('error' in converted) return textResult(`Error: ${converted.error}`)

  const id = ulid()
  const location = p.data.location ?? null
  await batchWithAudit(ctx.db, [ctx.db.insert(menus).values({ id, siteId: ctx.siteId, name: p.data.name, location, items: converted.items })],
    buildAuditLogInsert(ctx.event, ctx.apiKeyUserId, { action: 'create', resource: 'menu', resourceId: id, after: { name: p.data.name, location, items: converted.items } }))
  await purgeMenuLocations(ctx.event, ctx.siteId, [location])
  return textResult(`Success: Menu created with ID: ${id}`)
}

async function updateMenu(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'change menus')
  if (denied) return denied
  const p = parseToolArgs(updateMenuArgs, args)
  if ('error' in p) return p.error
  const existing = await ctx.db.query.menus.findFirst({ where: and(eq(menus.id, p.data.id), eq(menus.siteId, ctx.siteId)) })
  if (!existing) return textResult(`Error: Menu "${p.data.id}" not found.`)

  const changes: Partial<typeof menus.$inferInsert> = {}
  if (p.data.name !== undefined) changes.name = p.data.name
  if (p.data.location !== undefined) changes.location = p.data.location
  if (p.data.items !== undefined) {
    const converted = await toStoredMenuItems(ctx, p.data.items)
    if ('error' in converted) return textResult(`Error: ${converted.error}`)
    changes.items = converted.items
  }
  if (!Object.keys(changes).length) return textResult('Error: Nothing to change — give name, location or items.')

  const update = ctx.db.update(menus).set({ ...changes, updatedAt: sql`(datetime('now'))` }).where(scopedById(menus.id, existing.id, menus.siteId, ctx.siteId))
  await batchWithAudit(ctx.db, [update], buildAuditLogInsert(ctx.event, ctx.apiKeyUserId, { action: 'update', resource: 'menu', resourceId: existing.id, before: existing, after: changes }))
  await purgeMenuLocations(ctx.event, ctx.siteId, [existing.location, changes.location === undefined ? existing.location : changes.location])
  return textResult(`Success: Menu ${existing.id} updated.`)
}

async function deleteMenu(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'change menus')
  if (denied) return denied
  const p = parseToolArgs(idArgs, args)
  if ('error' in p) return p.error
  const existing = await ctx.db.query.menus.findFirst({ where: and(eq(menus.id, p.data.id), eq(menus.siteId, ctx.siteId)) })
  if (!existing) return textResult(`Error: Menu "${p.data.id}" not found.`)
  await batchWithAudit(ctx.db, [ctx.db.delete(menus).where(scopedById(menus.id, existing.id, menus.siteId, ctx.siteId))],
    buildAuditLogInsert(ctx.event, ctx.apiKeyUserId, { action: 'delete', resource: 'menu', resourceId: existing.id, before: existing }))
  await purgeMenuLocations(ctx.event, ctx.siteId, [existing.location])
  return textResult(`Success: Menu ${existing.id} deleted.`)
}

// ── Redirects ─────────────────────────────────────────────────────────────────

async function listRedirects(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'see redirects')
  if (denied) return denied
  const p = parseToolArgs(listRedirectsArgs, args)
  if ('error' in p) return p.error
  const conditions: SQL[] = [eq(redirects.siteId, ctx.siteId)]
  if (p.data.query) {
    const pattern = `%${escapeLike(p.data.query)}%`
    conditions.push(sql`(${redirects.from} LIKE ${pattern} ESCAPE '\\' OR ${redirects.to} LIKE ${pattern} ESCAPE '\\')`)
  }
  const rows = await ctx.db.query.redirects.findMany({
    where: and(...conditions),
    orderBy: [desc(redirects.createdAt), desc(redirects.id)],
    limit: p.data.limit ?? 20,
    offset: p.data.offset ?? 0,
    columns: { id: true, from: true, to: true, statusCode: true, createdAt: true },
  })
  return toolJsonResult(rows)
}

async function createRedirect(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'change redirects')
  if (denied) return denied
  const p = parseToolArgs(redirectRuleSchema, args)
  if ('error' in p) return p.error
  const saved = await saveRedirect(ctx.db, ctx.siteId, p.data, { overwrite: false })
  if (saved.action === 'unchanged') return textResult(`Error: A redirect from "${saved.from}" already exists (ID ${saved.id}) — delete it first to replace it.`)
  await writeAuditLog(ctx.event, ctx.apiKeyUserId, {
    action: 'create', resource: 'redirect', resourceId: saved.id, after: { from: saved.from, to: saved.to, statusCode: saved.statusCode },
  })
  return textResult(`Success: ${saved.from} now redirects ${saved.statusCode === 410 ? 'as gone (410)' : `to ${saved.to} (${saved.statusCode})`}. ID: ${saved.id}`)
}

async function deleteRedirect(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'change redirects')
  if (denied) return denied
  const p = parseToolArgs(idArgs, args)
  if ('error' in p) return p.error
  const existing = await ctx.db.query.redirects.findFirst({ where: and(eq(redirects.id, p.data.id), eq(redirects.siteId, ctx.siteId)) })
  if (!existing) return textResult(`Error: Redirect "${p.data.id}" not found.`)
  await batchWithAudit(ctx.db, [ctx.db.delete(redirects).where(scopedById(redirects.id, existing.id, redirects.siteId, ctx.siteId))],
    buildAuditLogInsert(ctx.event, ctx.apiKeyUserId, { action: 'delete', resource: 'redirect', resourceId: existing.id, before: existing }))
  clearRedirectCache(ctx.siteId)
  return textResult(`Success: The redirect from ${existing.from} was deleted.`)
}

// ── Forms ─────────────────────────────────────────────────────────────────────

async function listForms(_args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'read form submissions')
  if (denied) return denied
  const rows = await ctx.db.query.forms.findMany({
    where: eq(forms.siteId, ctx.siteId),
    orderBy: [asc(forms.name)],
    columns: { id: true, name: true, slug: true, status: true, fields: true },
  })
  const counts = await ctx.db
    .select({
      formId: formSubmissions.formId,
      total: sql<number>`count(*)`,
      unread: sql<number>`sum(case when ${formSubmissions.status} = 'new' then 1 else 0 end)`,
    })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.siteId, ctx.siteId), ne(formSubmissions.status, 'spam')))
    .groupBy(formSubmissions.formId)
  const byForm = new Map(counts.map(c => [c.formId, c]))
  return toolJsonResult(rows.map(f => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    status: f.status,
    fields: f.fields.filter(field => field.type !== 'step').map(field => ({ name: field.name, label: field.label, type: field.type })),
    submissions: Number(byForm.get(f.id)?.total ?? 0),
    new: Number(byForm.get(f.id)?.unread ?? 0),
  })))
}

async function listFormSubmissions(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const denied = toolRoleError(ctx, 'editor', 'read form submissions')
  if (denied) return denied
  const p = parseToolArgs(listSubmissionsArgs, args)
  if ('error' in p) return p.error
  const form = await ctx.db.query.forms.findFirst({
    where: and(eq(forms.siteId, ctx.siteId), sql`(${forms.id} = ${p.data.form} OR ${forms.slug} = ${p.data.form})`),
    columns: { id: true, name: true },
  })
  if (!form) return textResult(`Error: Form "${p.data.form}" not found. Use list_forms to see this site's forms.`)

  const conditions: SQL[] = [eq(formSubmissions.siteId, ctx.siteId), eq(formSubmissions.formId, form.id)]
  if (p.data.status !== 'all') conditions.push(inArray(formSubmissions.status, [...SUBMISSION_FILTERS[p.data.status]]))
  const rows = await ctx.db.query.formSubmissions.findMany({
    where: and(...conditions),
    orderBy: [desc(formSubmissions.createdAt), desc(formSubmissions.id)],
    limit: p.data.limit ?? 20,
    offset: p.data.offset ?? 0,
    // Never the IP address or browser: an assistant has no use for them.
    columns: { id: true, status: true, createdAt: true, data: true },
  })
  return toolJsonResult({
    form: form.name,
    submissions: rows.map(r => ({ id: r.id, status: r.status, createdAt: r.createdAt, data: publicSubmissionData(r.data) })),
  })
}

/** Runs one of MCP_SITE_TOOLS (the caller has already checked the key's scope). */
export async function callSiteTool(name: string, args: unknown, ctx: McpToolContext): Promise<McpToolResult | null> {
  switch (name) {
    case 'list_media': return listMedia(args, ctx)
    case 'update_media': return updateMedia(args, ctx)
    case 'upload_media': return uploadMedia(args, ctx)
    case 'list_menus': return listMenus(args, ctx)
    case 'create_menu': return createMenu(args, ctx)
    case 'update_menu': return updateMenu(args, ctx)
    case 'delete_menu': return deleteMenu(args, ctx)
    case 'list_redirects': return listRedirects(args, ctx)
    case 'create_redirect': return createRedirect(args, ctx)
    case 'delete_redirect': return deleteRedirect(args, ctx)
    case 'list_forms': return listForms(args, ctx)
    case 'list_form_submissions': return listFormSubmissions(args, ctx)
    default: return null
  }
}
