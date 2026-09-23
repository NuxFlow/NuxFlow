import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { forms, formSubmissions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// rate-limit.ts relies on Nitro's auto-imported `useDb` global (not an explicit import),
// which isn't available in the Vitest environment — every other integration test whose
// route calls rateLimit() mocks it out the same way (see users-pending-resend.test.ts).
// The rate limiter's own atomic-increment logic is covered separately in
// tests/unit/rate-limit-memory.test.ts.
const rateLimitMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}))

// moderateText() itself is tested directly in moderation.test.ts — mocked here so the
// dedicated AI-moderation test below can control its verdict.
const mockModerateText = vi.fn().mockResolvedValue(null)
vi.mock('../../server/utils/moderation', () => ({
  moderateText: (...args: unknown[]) => mockModerateText(...args),
}))

const { default: submitHandler } = await import('../../server/api/v1/contact/submit.post')
const { default: submissionsHandler } = await import('../../server/api/v1/contact/submissions.get')
const { default: submissionPatchHandler } = await import('../../server/api/v1/contact/submissions/[id].patch')

const SITE = 'site-contact-01'

let editorId: string
let authorId: string
let adminId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'contact.localhost' })

  editorId = await seedUser(db, { email: 'editor@contact.test', name: 'Editor' })
  authorId = await seedUser(db, { email: 'author@contact.test', name: 'Author' })
  adminId = await seedUser(db, { email: 'admin@contact.test', name: 'Admin' })

  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, adminId, SITE, 'admin')
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function publicEvent(body: unknown, ip = '203.0.113.5') {
  return createMockEvent({
    siteId: SITE,
    session: null,
    body,
    headers: { 'cf-connecting-ip': ip },
  }) as unknown as H3Event
}

function editorEvent(opts: { query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@contact.test' } },
    query: opts.query,
    params: opts.params,
    body: opts.body,
  }) as unknown as H3Event
}

function authorEvent(opts: { query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@contact.test' } },
    query: opts.query,
    params: opts.params,
    body: opts.body,
  }) as unknown as H3Event
}

describe('POST /api/v1/contact/submit', () => {
  it('creates the contact form on first submission and stores the submission', async () => {
    const event = publicEvent({
      name: 'Jane Visitor',
      email: 'jane@example.com',
      subject: 'Hello',
      message: 'This is a test message.',
    }, '203.0.113.10')

    const result = await (submitHandler as Handler)(event) as { success: boolean }
    expect(result.success).toBe(true)

    const db = getCurrentTestDb()
    const form = await db.query.forms.findFirst({ where: and(eq(forms.siteId, SITE), eq(forms.slug, 'contact')) })
    expect(form).toBeDefined()
    expect(form!.name).toBe('Contact Form')

    const submission = await db.query.formSubmissions.findFirst({
      where: and(eq(formSubmissions.formId, form!.id), eq(formSubmissions.siteId, SITE)),
    })
    expect(submission).toBeDefined()
    expect((submission!.data as Record<string, unknown>).email).toBe('jane@example.com')
    expect(submission!.status).toBe('new')
  })

  it('reuses the same contact form on subsequent submissions rather than creating duplicates', async () => {
    await (submitHandler as Handler)(publicEvent({
      name: 'Second Visitor', email: 'second@example.com', message: 'Another message',
    }, '203.0.113.11'))

    const db = getCurrentTestDb()
    const allForms = await db.query.forms.findMany({ where: and(eq(forms.siteId, SITE), eq(forms.slug, 'contact')) })
    expect(allForms.length).toBe(1)
  })

  it('rejects a submission missing a required field', async () => {
    const event = publicEvent({ name: 'No Email', message: 'Missing email field' }, '203.0.113.12')
    await expect((submitHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects an invalid email address', async () => {
    const event = publicEvent({ name: 'Bad Email', email: 'not-an-email', message: 'Hi' }, '203.0.113.13')
    await expect((submitHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('applies rate limiting keyed to the contact-submit prefix', async () => {
    rateLimitMock.mockClear()
    await (submitHandler as Handler)(publicEvent({
      name: 'Rate Limited Visitor', email: 'ratelimited@example.com', message: 'msg',
    }, '203.0.113.99'))

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5, keyPrefix: 'contact-submit' }),
    )
  })

  it('auto-flags a submission as spam when the AI moderation model flags it', async () => {
    mockModerateText.mockResolvedValueOnce({ flagged: true, reason: 'Scam message' })
    const db = getCurrentTestDb()

    await (submitHandler as Handler)(publicEvent({
      name: 'Scammer', email: 'scammer@example.com', message: 'Wire me money urgently',
    }, '203.0.113.66'))

    // Background (waitUntil, fire-and-forget in this test environment) — poll for the
    // eventual DB update rather than the handler's own synchronous return value. Filtered
    // by email (not "most recent by createdAt") since SQLite's datetime('now') only has
    // second-level resolution — several other submissions in this file can tie on
    // createdAt with this one, making ordering-based lookup unreliable.
    const startedAt = Date.now()
    let submission: { status: string; data: unknown } | undefined
    while (Date.now() - startedAt < 2000) {
      const all = await db.query.formSubmissions.findMany({ where: eq(formSubmissions.siteId, SITE) })
      submission = all.find(s => (s.data as Record<string, unknown>).email === 'scammer@example.com')
      if (submission?.status === 'spam') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(submission?.status).toBe('spam')
  })
})

describe('GET /api/v1/contact/submissions', () => {
  it('throws 403 for author (below editor)', async () => {
    await expect((submissionsHandler as Handler)(authorEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists submissions for the contact form on this site', async () => {
    const result = await (submissionsHandler as Handler)(editorEvent()) as { submissions: unknown[]; total: number }
    expect(result.total).toBeGreaterThan(0)
    expect(Array.isArray(result.submissions)).toBe(true)
  })

  it('returns an empty result set when no contact form exists yet for the site', async () => {
    const freshSite = `site-contact-fresh-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: freshSite, domain: `contact-fresh-${ulid()}.localhost` })
    const freshEditor = await seedUser(db, { email: `editor-fresh-${ulid()}@test.com` })
    await seedRole(db, freshEditor, freshSite, 'editor')

    const event = createMockEvent({
      siteId: freshSite,
      session: { user: { id: freshEditor, name: 'Fresh Editor', email: 'editor-fresh@test.com' } },
    }) as unknown as H3Event

    const result = await (submissionsHandler as Handler)(event) as { submissions: unknown[]; total: number }
    expect(result.total).toBe(0)
    expect(result.submissions).toEqual([])
  })
})

describe('PATCH /api/v1/contact/submissions/:id', () => {
  it('updates submission status', async () => {
    const db = getCurrentTestDb()
    const form = await db.query.forms.findFirst({ where: and(eq(forms.siteId, SITE), eq(forms.slug, 'contact')) })
    const submission = await db.query.formSubmissions.findFirst({ where: eq(formSubmissions.formId, form!.id) })

    const result = await (submissionPatchHandler as Handler)(
      editorEvent({ params: { id: submission!.id }, body: { status: 'read' } }),
    ) as { success: boolean }
    expect(result.success).toBe(true)

    const updated = await db.query.formSubmissions.findFirst({ where: eq(formSubmissions.id, submission!.id) })
    expect(updated?.status).toBe('read')
  })

  it('throws 404 for a submission belonging to another site', async () => {
    const otherSite = `site-contact-other-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: otherSite, domain: `contact-other-${ulid()}.localhost` })
    const otherForm = ulid()
    await db.insert(forms).values({ id: otherForm, siteId: otherSite, name: 'Contact Form', slug: 'contact', fields: [], status: 'active' })
    const otherSubmission = ulid()
    await db.insert(formSubmissions).values({ id: otherSubmission, formId: otherForm, siteId: otherSite, data: {}, status: 'new' })

    await expect(
      (submissionPatchHandler as Handler)(editorEvent({ params: { id: otherSubmission }, body: { status: 'archived' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 422 for an invalid status value', async () => {
    const db = getCurrentTestDb()
    const form = await db.query.forms.findFirst({ where: and(eq(forms.siteId, SITE), eq(forms.slug, 'contact')) })
    const submission = await db.query.formSubmissions.findFirst({ where: eq(formSubmissions.formId, form!.id) })

    await expect(
      (submissionPatchHandler as Handler)(editorEvent({ params: { id: submission!.id }, body: { status: 'bogus' } })),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})
