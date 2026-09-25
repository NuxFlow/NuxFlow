/**
 * Integration tests for POST /api/v1/ai/translate and POST /api/v1/ai/grammar.
 * The model is mocked; everything else (DB, content walking, audit) is real.
 *
 * translate: extracts every translatable string (TipTap text nodes / Canvas text props,
 * nested slots included), writes the model's output back into the same structure, and
 * saves a *draft* linked to the source via sourceItemId + locale — re-running updates
 * that draft instead of duplicating it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))

const { mockGetModel, mockGenerateObject } = vi.hoisted(() => ({
  mockGetModel: vi.fn(),
  mockGenerateObject: vi.fn(),
}))
vi.mock('../../server/utils/ai-sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAiSdkModel: mockGetModel,
  requireAiSdkModel: async (...args: unknown[]) => {
    const m = await mockGetModel(...args)
    if (!m) throw Object.assign(new Error('No AI provider configured'), { statusCode: 503 })
    return m
  },
}))
vi.mock('ai', () => ({ generateObject: mockGenerateObject }))

const { default: translateHandler } = await import('../../server/api/v1/ai/translate.post')
const { default: grammarHandler } = await import('../../server/api/v1/ai/grammar.post')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-ai-translate-01'
let editorId: string
let authorId: string
let typeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'tr.localhost' })
  editorId = await seedUser(db, { email: 'editor@tr.test' })
  authorId = await seedUser(db, { email: 'author@tr.test' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  typeId = await seedContentType(db, SITE, { slug: 'page' })
})
afterAll(teardownTestDb)

/** Fake translator: prefixes every value with "ES:" and records the bundle it was given. */
let lastBundle: Record<string, string> = {}
beforeEach(() => {
  mockGetModel.mockResolvedValue({ id: 'fake-model' })
  mockGenerateObject.mockReset().mockImplementation(async ({ prompt }: { prompt: string }) => {
    lastBundle = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return { object: Object.fromEntries(Object.entries(lastBundle).map(([k, v]) => [k, `ES:${v}`])) }
  })
})

function ev(userId: string, body: unknown) {
  return createMockEvent({ siteId: SITE, session: { user: { id: userId, name: 'U', email: 'u@example.com' } }, body }) as unknown as H3Event
}

async function row(id: string) {
  return getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, id) })
}

describe('POST /api/v1/ai/translate', () => {
  it('forbids authors and 503s without a configured provider', async () => {
    const db = getCurrentTestDb()
    const id = await seedContentItem(db, SITE, typeId)
    await expect((translateHandler as Handler)(ev(authorId, { contentItemId: id, targetLocale: 'es' }))).rejects.toMatchObject({ statusCode: 403 })
    mockGetModel.mockResolvedValueOnce(null)
    await expect((translateHandler as Handler)(ev(editorId, { contentItemId: id, targetLocale: 'es' }))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('translates a TipTap page into a linked draft, preserving structure and marks', async () => {
    const db = getCurrentTestDb()
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' plain' }] },
      ],
    }
    const src = await seedContentItem(db, SITE, typeId, {
      slug: 'about', title: 'About', status: 'published', visibility: 'members', content, seoTitle: 'SEO', excerpt: 'Ex',
    })

    const res = await (translateHandler as Handler)(ev(editorId, { contentItemId: src, targetLocale: 'es' })) as { id: string; slug: string; updated: boolean }
    expect(res).toMatchObject({ slug: 'about-es', updated: false })

    const t = await row(res.id)
    expect(t).toMatchObject({
      title: 'ES:About', seoTitle: 'ES:SEO', excerpt: 'ES:Ex', locale: 'es', sourceItemId: src,
      status: 'draft', visibility: 'members', authorId: editorId,
    })
    expect(t?.content).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'ES:Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'ES:Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: 'ES: plain' }] },
      ],
    })
    const log = await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.resourceId, res.id), eq(auditLogs.action, 'create')) })
    expect(log).toBeDefined()
  })

  it('translates Canvas text props (including nested slots) but leaves non-text props alone', async () => {
    const db = getCurrentTestDb()
    const content = {
      type: 'canvas',
      blocks: [
        { id: 'h', type: 'canvas-hero', props: { headline: 'Welcome', ctaUrl: '/signup', bgColor: '#fff' } },
        { id: 'c', type: 'columns', props: {}, children: { left: [{ id: 't', type: 'canvas-text', props: { content: '<p>Hi</p>' } }] } },
      ],
    }
    const src = await seedContentItem(db, SITE, typeId, { slug: 'landing', title: 'Landing', content })
    const res = await (translateHandler as Handler)(ev(editorId, { contentItemId: src, targetLocale: 'fr', targetSlugSuffix: '-francais' })) as { id: string; slug: string }

    expect(res.slug).toBe('landing-francais')
    expect(Object.keys(lastBundle)).not.toContain('h.ctaUrl')
    const t = await row(res.id) as { content: { blocks: { props: Record<string, unknown>; children?: Record<string, { props: Record<string, unknown> }[]> }[] } }
    expect(t.content.blocks[0]!.props).toEqual({ headline: 'ES:Welcome', ctaUrl: '/signup', bgColor: '#fff' })
    expect(t.content.blocks[1]!.children!.left![0]!.props.content).toBe('ES:<p>Hi</p>')
  })

  it('updates the existing translation on re-run instead of creating a duplicate', async () => {
    const db = getCurrentTestDb()
    const src = await seedContentItem(db, SITE, typeId, { slug: 'rerun', title: 'Rerun' })
    const first = await (translateHandler as Handler)(ev(editorId, { contentItemId: src, targetLocale: 'de' })) as { id: string }
    await db.update(contentItems).set({ title: 'Rerun v2' }).where(eq(contentItems.id, src))

    const second = await (translateHandler as Handler)(ev(editorId, { contentItemId: src, targetLocale: 'de' })) as { id: string; updated: boolean }
    expect(second).toMatchObject({ id: first.id, updated: true })
    expect((await row(first.id))?.title).toBe('ES:Rerun v2')
    const copies = await db.query.contentItems.findMany({ where: and(eq(contentItems.sourceItemId, src), eq(contentItems.locale, 'de')) })
    expect(copies).toHaveLength(1)
  })

  it('409s before calling the model when the translation slug is already taken', async () => {
    const db = getCurrentTestDb()
    const src = await seedContentItem(db, SITE, typeId, { slug: 'pricing', title: 'Pricing' })
    await seedContentItem(db, SITE, typeId, { slug: 'pricing-it', title: 'Unrelated page' })
    await expect((translateHandler as Handler)(ev(editorId, { contentItemId: src, targetLocale: 'it' }))).rejects.toMatchObject({ statusCode: 409 })
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('404s for an unknown item and surfaces a model failure as 502', async () => {
    await expect((translateHandler as Handler)(ev(editorId, { contentItemId: 'nope', targetLocale: 'es' }))).rejects.toMatchObject({ statusCode: 404 })
    const src = await seedContentItem(getCurrentTestDb(), SITE, typeId, { slug: 'fails' })
    mockGenerateObject.mockRejectedValueOnce(new Error('provider exploded'))
    await expect((translateHandler as Handler)(ev(editorId, { contentItemId: src, targetLocale: 'es' }))).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('POST /api/v1/ai/grammar', () => {
  it('returns the model\'s corrections for editors only', async () => {
    const corrections = { corrections: [{ original: 'teh', corrected: 'the', reason: 'typo' }] }
    mockGenerateObject.mockResolvedValueOnce({ object: corrections })
    expect(await (grammarHandler as Handler)(ev(editorId, { text: 'teh cat' }))).toEqual(corrections)
    await expect((grammarHandler as Handler)(ev(authorId, { text: 'x' }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('validates text length', async () => {
    await expect((grammarHandler as Handler)(ev(editorId, { text: '' }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((grammarHandler as Handler)(ev(editorId, { text: 'x'.repeat(10_001) }))).rejects.toMatchObject({ statusCode: 422 })
  })
})
