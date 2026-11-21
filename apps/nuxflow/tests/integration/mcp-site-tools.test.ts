/**
 * Integration tests for the MCP media, menu, redirect and form tools
 * (server/utils/mcp-site-tools.ts), through the real JSON-RPC handler.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia } from '../helpers/seed'
import { auditLogs, forms, formSubmissions, media, menus, redirects } from '@nuxflow/db/schema'
import mcpHandler from '../../server/api/v1/mcp'
import type * as Ssrf from '../../server/utils/ssrf'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const purgeEdgeCache = vi.fn().mockResolvedValue(undefined)
const purgeAllPublicPages = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/edge-cache', () => ({
  purgeContentCache: vi.fn().mockResolvedValue(undefined),
  purgeEdgeCache: (...a: unknown[]) => purgeEdgeCache(...a),
  purgeAllPublicPages: (...a: unknown[]) => purgeAllPublicPages(...a),
}))

const uploads: { key: string; type: string; size: number }[] = []
let storageAvailable = true
vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(async () => {
    if (!storageAvailable) {
      const { httpError } = await import('../../server/utils/response')
      throw httpError({ status: 409, message: 'Images and files need file storage', data: { code: 'storage_required' } })
    }
    return {
      name: 'r2',
      upload: async (file: File, key: string) => {
        uploads.push({ key, type: file.type, size: file.size })
        return { url: `/_nuxflow/media/${key}` }
      },
      delete: async () => {},
      getUrl: (key: string) => `/_nuxflow/media/${key}`,
    }
  }),
}))

const safeFetch = vi.fn()
vi.mock('../../server/utils/ssrf', async importOriginal => ({
  ...(await importOriginal<typeof Ssrf>()),
  safeFetch: (...a: unknown[]) => safeFetch(...a),
}))

const SITE = 'site-mcp-site-tools'
const OTHER_SITE = 'site-mcp-site-tools-other'
let editorId: string
let authorId: string
let pageTypeId: string

type HandlerFn = (e: H3Event) => Promise<unknown>
type ToolResponse = { result: { content: { text: string }[]; isError?: boolean } }

function call(name: string, args: unknown, o: { role?: string; scopes?: string[]; user?: string } = {}) {
  const event = createMockEvent({
    method: 'POST',
    siteId: SITE,
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    apiKeyUserId: o.user ?? editorId,
    apiKeyRole: o.role ?? 'editor',
    apiKeyScopes: o.scopes ?? ['read:content', 'write:content', 'read:personal'],
  }) as unknown as H3Event
  return (mcpHandler as HandlerFn)(event).then(r => (r as ToolResponse).result)
}
const text = (r: ToolResponse['result']) => r.content[0]!.text

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'mcp-tools.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'mcp-tools-other.localhost' })
  editorId = await seedUser(db, { email: 'mcp-tools-editor@test.com' })
  authorId = await seedUser(db, { email: 'mcp-tools-author@test.com' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  pageTypeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
})

afterAll(teardownTestDb)

describe('MCP media tools', () => {
  it('lists this site\'s images that need alt text, never another site\'s', async () => {
    const db = getCurrentTestDb()
    const bare = await seedMedia(db, SITE, { originalName: 'bare.jpg', mimeType: 'image/jpeg', altText: null })
    await seedMedia(db, SITE, { originalName: 'described.jpg', mimeType: 'image/jpeg', altText: 'A dog' })
    await seedMedia(db, SITE, { originalName: 'doc.pdf', mimeType: 'application/pdf', altText: null })
    await seedMedia(db, OTHER_SITE, { originalName: 'other.jpg', mimeType: 'image/jpeg', altText: null })

    const files = JSON.parse(text(await call('list_media', { missingAltText: true }))) as { id: string }[]
    expect(files.map(f => f.id)).toEqual([bare])

    const pdfs = JSON.parse(text(await call('list_media', { kind: 'pdf' }))) as { originalName: string }[]
    expect(pdfs.map(f => f.originalName)).toEqual(['doc.pdf'])
  })

  it('sets alt text and writes an audit entry; refuses another site\'s file', async () => {
    const db = getCurrentTestDb()
    const id = await seedMedia(db, SITE, { originalName: 'cat.jpg', mimeType: 'image/jpeg' })
    expect(text(await call('update_media', { id, altText: 'A cat asleep on a windowsill' }, { role: 'author', user: authorId }))).toContain('Success')
    const row = await db.query.media.findFirst({ where: eq(media.id, id) })
    expect(row!.altText).toBe('A cat asleep on a windowsill')
    const log = await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.resource, 'media'), eq(auditLogs.resourceId, id)) })
    expect(log!.action).toBe('update')

    const foreign = await seedMedia(db, OTHER_SITE, { originalName: 'theirs.jpg', mimeType: 'image/jpeg' })
    const res = await call('update_media', { id: foreign, altText: 'x' })
    expect(res.isError).toBe(true)
    expect(text(res)).toMatch(/not found/)
  })

  it('needs write:content to change media', async () => {
    const id = await seedMedia(getCurrentTestDb(), SITE, { originalName: 'x.jpg', mimeType: 'image/jpeg' })
    expect(text(await call('update_media', { id, altText: 'x' }, { scopes: ['read:content'] }))).toMatch(/write:content/)
  })

  it('uploads inline base64 through the shared upload path', async () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0))
    const res = await call('upload_media', { dataBase64: png, mimeType: 'image/png', filename: 'dot', altText: 'A dot' }, { role: 'author', user: authorId })
    expect(res.isError).toBeUndefined()
    const out = JSON.parse(text(res)) as { id: string; name: string; width: number; height: number }
    expect(out).toMatchObject({ name: 'dot.png', width: 2, height: 3 })
    const row = await getCurrentTestDb().query.media.findFirst({ where: eq(media.id, out.id) })
    expect(row).toMatchObject({ siteId: SITE, altText: 'A dot', mimeType: 'image/png', uploadedBy: authorId })
    expect(uploads.at(-1)!.key.startsWith(`${SITE}/`)).toBe(true)
  })

  it('downloads from a URL, and refuses types the library doesn\'t take', async () => {
    safeFetch.mockResolvedValueOnce(new Response(new Uint8Array([0xFF, 0xD8, 0xFF]), { headers: { 'content-type': 'image/jpeg; charset=binary' } }))
    const ok = JSON.parse(text(await call('upload_media', { url: 'https://example.com/photos/beach.jpg' }))) as { name: string; mimeType: string }
    expect(ok).toMatchObject({ name: 'beach.jpg', mimeType: 'image/jpeg' })

    safeFetch.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }))
    const refused = await call('upload_media', { url: 'https://example.com/page' })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toMatch(/Unsupported file type/)
  })

  it('reports missing storage as a tool error, not a protocol failure', async () => {
    storageAvailable = false
    const fetches = safeFetch.mock.calls.length
    try {
      const res = await call('upload_media', { url: 'https://example.com/a.jpg' })
      expect(res.isError).toBe(true)
      expect(text(res)).toMatch(/file storage/)
      // Refused before anything was downloaded.
      expect(safeFetch.mock.calls.length).toBe(fetches)
    } finally {
      storageAvailable = true
    }
  })

  it('does not let a viewer upload', async () => {
    expect(text(await call('upload_media', { dataBase64: 'AAAA', mimeType: 'image/png' }, { role: 'viewer' }))).toMatch(/needs author/)
  })
})

describe('MCP menu tools', () => {
  it('creates a header menu from page slugs and links, and purges every page', async () => {
    const db = getCurrentTestDb()
    const aboutId = await seedContentItem(db, SITE, pageTypeId, { slug: 'about', title: 'About' })
    purgeAllPublicPages.mockClear()
    const res = await call('create_menu', {
      name: 'Main',
      location: 'header',
      items: [
        { label: 'About', page: 'about', children: [{ label: 'Blog', url: '/blog' }] },
        { label: 'Shop', url: 'https://shop.example.com', newTab: true },
      ],
    })
    expect(text(res)).toContain('Success')
    const row = await db.query.menus.findFirst({ where: and(eq(menus.siteId, SITE), eq(menus.name, 'Main')) })
    expect(row!.location).toBe('header')
    expect(row!.items).toMatchObject([
      { label: 'About', type: 'page', contentId: aboutId, slug: 'about', target: '_self', children: [{ label: 'Blog', type: 'url', url: '/blog' }] },
      { label: 'Shop', type: 'url', url: 'https://shop.example.com', target: '_blank', children: [] },
    ])
    expect(purgeEdgeCache).toHaveBeenCalledWith(expect.anything(), ['/api/public/menus/header'])
    expect(purgeAllPublicPages).toHaveBeenCalled()

    const listed = JSON.parse(text(await call('list_menus', {}))) as { name: string; items: unknown[] }[]
    expect(listed.find(m => m.name === 'Main')!.items).toEqual([
      { label: 'About', page: 'about', children: [{ label: 'Blog', url: '/blog' }] },
      { label: 'Shop', url: 'https://shop.example.com', newTab: true },
    ])
  })

  it('refuses a page slug that isn\'t on this site, and a non-link url', async () => {
    const db = getCurrentTestDb()
    const otherType = await seedContentType(db, OTHER_SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
    await seedContentItem(db, OTHER_SITE, otherType, { slug: 'theirs' })
    expect(text(await call('create_menu', { name: 'Bad', items: [{ label: 'X', page: 'theirs' }] }))).toMatch(/No page or post with slug "theirs"/)
    expect(text(await call('create_menu', { name: 'Bad', items: [{ label: 'X', url: 'javascript:alert(1)' }] }))).toMatch(/isn't a link/)
    expect(await db.query.menus.findFirst({ where: and(eq(menus.siteId, SITE), eq(menus.name, 'Bad')) })).toBeUndefined()
  })

  it('moves and deletes a menu, purging both locations; authors may not', async () => {
    const db = getCurrentTestDb()
    const id = ulid()
    await db.insert(menus).values({ id, siteId: SITE, name: 'Foot', location: 'sidebar', items: [] })
    expect(text(await call('update_menu', { id, location: 'footer' }, { role: 'author', user: authorId }))).toMatch(/needs editor/)

    purgeEdgeCache.mockClear()
    expect(text(await call('update_menu', { id, location: 'footer' }))).toContain('Success')
    expect(purgeEdgeCache).toHaveBeenCalledWith(expect.anything(), ['/api/public/menus/sidebar', '/api/public/menus/footer'])

    expect(text(await call('delete_menu', { id }))).toContain('Success')
    expect(await db.query.menus.findFirst({ where: eq(menus.id, id) })).toBeUndefined()
    const log = await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.resource, 'menu'), eq(auditLogs.resourceId, id), eq(auditLogs.action, 'delete')) })
    expect(log).toBeTruthy()
  })
})

describe('MCP redirect tools', () => {
  it('creates, lists and deletes a redirect, flattening chains', async () => {
    const db = getCurrentTestDb()
    expect(text(await call('create_redirect', { from: '/old', to: '/middle' }))).toContain('Success')
    expect(text(await call('create_redirect', { from: '/Middle/', to: '/new', statusCode: 308 }))).toContain('Success')
    const rules = JSON.parse(text(await call('list_redirects', {}))) as { id: string; from: string; to: string; statusCode: number }[]
    expect(rules.find(r => r.from === '/old')!.to).toBe('/new')
    expect(rules.find(r => r.from === '/middle')!.statusCode).toBe(308)

    const dup = await call('create_redirect', { from: '/old', to: '/elsewhere' })
    expect(dup.isError).toBe(true)
    expect(text(dup)).toMatch(/already exists/)

    const id = rules.find(r => r.from === '/old')!.id
    expect(text(await call('delete_redirect', { id }))).toContain('Success')
    expect(await db.query.redirects.findFirst({ where: eq(redirects.id, id) })).toBeUndefined()
  })

  it('validates rules like the admin does, and needs editor', async () => {
    expect(text(await call('create_redirect', { from: '/a', to: '/a' }))).toMatch(/cannot point to itself/)
    expect(text(await call('create_redirect', { from: '/gone', statusCode: 410 }))).toMatch(/gone \(410\)/)
    expect(text(await call('list_redirects', {}, { role: 'author', user: authorId }))).toMatch(/needs editor/)
  })
})

describe('MCP form submission tools', () => {
  let formId: string
  beforeAll(async () => {
    const db = getCurrentTestDb()
    formId = ulid()
    await db.insert(forms).values({
      id: formId,
      siteId: SITE,
      name: 'Contact',
      slug: 'contact',
      fields: [
        { id: 'f1', type: 'text', label: 'Name', name: 'name' },
        { id: 'f2', type: 'file', label: 'Photo', name: 'photo' },
      ],
    })
    await db.insert(formSubmissions).values([
      { id: ulid(), formId, siteId: SITE, status: 'new', ipAddress: '203.0.113.9', userAgent: 'secret-agent', data: { name: 'Ada', photo: [{ kind: 'file', key: `_private/${SITE}/forms/x/y/photo.jpg`, name: 'photo.jpg', size: 10, type: 'image/jpeg' }] } },
      { id: ulid(), formId, siteId: SITE, status: 'spam', data: { name: 'Buy pills' } },
    ])
  })

  it('lists forms with counts that leave spam out', async () => {
    const out = JSON.parse(text(await call('list_forms', {}))) as { slug: string; submissions: number; new: number; fields: { name: string }[] }[]
    expect(out.find(f => f.slug === 'contact')).toMatchObject({ submissions: 1, new: 1, fields: [{ name: 'name' }, { name: 'photo' }] })
  })

  it('reads submissions by slug without IPs, browsers or file keys', async () => {
    const raw = text(await call('list_form_submissions', { form: 'contact' }))
    expect(raw).not.toContain('203.0.113.9')
    expect(raw).not.toContain('secret-agent')
    expect(raw).not.toContain('_private/')
    expect(raw).not.toContain('Buy pills')
    const out = JSON.parse(raw) as { submissions: { data: Record<string, unknown> }[] }
    expect(out.submissions).toHaveLength(1)
    expect(out.submissions[0]!.data).toEqual({ name: 'Ada', photo: [{ name: 'photo.jpg', size: 10, type: 'image/jpeg' }] })

    const spam = JSON.parse(text(await call('list_form_submissions', { form: formId, status: 'spam' }))) as { submissions: unknown[] }
    expect(spam.submissions).toHaveLength(1)
  })

  it('needs the read:personal scope (read:content is not enough) and editor', async () => {
    expect(text(await call('list_form_submissions', { form: 'contact' }, { scopes: ['read:content', 'write:content'] }))).toMatch(/read:personal/)
    expect(text(await call('list_forms', {}, { role: 'author', user: authorId }))).toMatch(/needs editor/)
  })

  it('advertises every tool in tools/list', async () => {
    const event = createMockEvent({
      method: 'POST', siteId: SITE, apiKeyUserId: editorId, apiKeyRole: 'editor', apiKeyScopes: ['read:content'],
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    }) as unknown as H3Event
    const res = await (mcpHandler as HandlerFn)(event) as { result: { tools: { name: string }[] } }
    expect(res.result.tools.map(t => t.name)).toEqual(expect.arrayContaining([
      'list_media', 'update_media', 'upload_media', 'list_menus', 'create_menu', 'update_menu', 'delete_menu',
      'list_redirects', 'create_redirect', 'delete_redirect', 'list_forms', 'list_form_submissions',
    ]))
  })
})
