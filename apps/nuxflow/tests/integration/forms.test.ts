import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { forms, formSubmissions, auditLogs } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
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
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const { default: listHandler } = await import('../../server/api/v1/forms/index.get')
const { default: createHandler } = await import('../../server/api/v1/forms/index.post')
const { default: getHandler } = await import('../../server/api/v1/forms/[formIdentifier]/index.get')
const { default: patchHandler } = await import('../../server/api/v1/forms/[formIdentifier]/index.patch')
const { default: submissionsHandler } = await import('../../server/api/v1/forms/[formIdentifier]/submissions.get')
const { default: submitHandler } = await import('../../server/api/v1/forms/[formIdentifier]/submit.post')

const SITE = 'site-forms-01'
const OTHER_SITE = 'site-forms-02'

let editorId: string
let authorId: string

const SAMPLE_FIELDS: FormField[] = [
  { id: 'f1', type: 'text', label: 'Full name', name: 'fullName', required: true },
  { id: 'f2', type: 'email', label: 'Email', name: 'email', required: true },
]

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'forms.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'forms2.localhost' })

  editorId = await seedUser(db, { email: 'editor@forms.test', name: 'Editor' })
  authorId = await seedUser(db, { email: 'author@forms.test', name: 'Author' })

  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function editorEvent(opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@forms.test' } },
    body: opts.body,
    params: opts.params,
    query: opts.query,
  }) as unknown as H3Event
}

function authorEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@forms.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

function publicEvent(opts: { body?: unknown; params?: Record<string, string>; ip?: string } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: null,
    body: opts.body,
    params: opts.params,
    headers: { 'cf-connecting-ip': opts.ip ?? '198.51.100.20' },
  }) as unknown as H3Event
}

async function seedForm(overrides: Partial<typeof forms.$inferInsert> = {}) {
  const db = getCurrentTestDb()
  const id = overrides.id ?? ulid()
  const slug = overrides.slug ?? `survey-${id.toLowerCase()}`
  await db.insert(forms).values({
    id, siteId: SITE, name: 'Survey', slug,
    fields: SAMPLE_FIELDS, logic: [], status: 'active',
    ...overrides,
  })
  return { id, slug }
}

describe('GET /api/v1/forms', () => {
  it('throws 403 for author (below editor)', async () => {
    await expect((listHandler as Handler)(authorEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists forms scoped to the current site', async () => {
    const { id } = await seedForm({ name: 'Visible Form' })
    await seedForm({ id: ulid(), siteId: OTHER_SITE, name: 'Other Site Form', slug: 'other-form' })

    const result = await (listHandler as Handler)(editorEvent()) as { forms: { id: string; name: string }[] }
    expect(result.forms.some(f => f.id === id)).toBe(true)
    expect(result.forms.some(f => f.name === 'Other Site Form')).toBe(false)
  })
})

describe('POST /api/v1/forms', () => {
  it('creates a form with fields and writes an audit log', async () => {
    const slug = `new-form-${ulid().toLowerCase()}`
    const event = editorEvent({ body: { name: 'New Form', slug, fields: SAMPLE_FIELDS, status: 'draft' } })
    const result = await (createHandler as Handler)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.forms.findFirst({ where: eq(forms.id, result.id) })
    expect(row?.name).toBe('New Form')
    expect(row?.status).toBe('draft')
    expect((row?.fields as FormField[]).length).toBe(2)

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'form'), eq(auditLogs.resourceId, result.id)),
    })
    expect(log?.action).toBe('create')
  })

  it('throws 403 for author (below editor)', async () => {
    await expect(
      (createHandler as Handler)(authorEvent({ body: { name: 'X', slug: `x-${ulid()}` } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET /api/v1/forms/:formIdentifier', () => {
  it('returns a single form by id', async () => {
    const { id } = await seedForm({ name: 'Fetchable' })
    const result = await (getHandler as Handler)(editorEvent({ params: { formIdentifier: id } })) as { id: string; name: string }
    expect(result.name).toBe('Fetchable')
  })

  it('throws 404 for a form on another site', async () => {
    const { id } = await seedForm({ id: ulid(), siteId: OTHER_SITE, name: 'Foreign', slug: 'foreign-form' })
    await expect(
      (getHandler as Handler)(editorEvent({ params: { formIdentifier: id } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('PATCH /api/v1/forms/:formIdentifier', () => {
  it('updates form status', async () => {
    const { id } = await seedForm({ status: 'draft' })
    await (patchHandler as Handler)(editorEvent({ params: { formIdentifier: id }, body: { status: 'active' } }))

    const db = getCurrentTestDb()
    const row = await db.query.forms.findFirst({ where: eq(forms.id, id) })
    expect(row?.status).toBe('active')
  })
})

describe('POST /api/v1/forms/:formIdentifier/submit (public)', () => {
  it('accepts a valid submission matching the declared fields', async () => {
    const { id, slug } = await seedForm({ status: 'active' })
    const event = publicEvent({ params: { formIdentifier: slug }, body: { data: { fullName: 'Jane Doe', email: 'jane@example.com' } } })
    const result = await (submitHandler as Handler)(event) as { success: boolean }
    expect(result.success).toBe(true)

    const db = getCurrentTestDb()
    const submission = await db.query.formSubmissions.findFirst({ where: eq(formSubmissions.formId, id) })
    expect(submission).toBeDefined()
    expect((submission!.data as Record<string, unknown>).fullName).toBe('Jane Doe')
  })

  it('rejects a submission with an unknown field', async () => {
    const { slug } = await seedForm({ status: 'active' })
    const event = publicEvent({
      params: { formIdentifier: slug },
      body: { data: { fullName: 'X', email: 'x@example.com', notAField: 'hack' } },
      ip: '198.51.100.30',
    })
    await expect((submitHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects a submission missing a required field', async () => {
    const { slug } = await seedForm({ status: 'active' })
    const event = publicEvent({ params: { formIdentifier: slug }, body: { data: { fullName: 'Only Name' } }, ip: '198.51.100.31' })
    await expect((submitHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects a submission to a non-active (draft) form', async () => {
    const { slug } = await seedForm({ status: 'draft' })
    const event = publicEvent({ params: { formIdentifier: slug }, body: { data: { fullName: 'X', email: 'x@example.com' } }, ip: '198.51.100.32' })
    await expect((submitHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 404 for a nonexistent form', async () => {
    const event = publicEvent({ params: { formIdentifier: 'does-not-exist' }, body: { data: {} }, ip: '198.51.100.33' })
    await expect((submitHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/v1/forms/:formIdentifier/submissions', () => {
  it('lists submissions for a form', async () => {
    const { id, slug } = await seedForm({ status: 'active' })
    await (submitHandler as Handler)(publicEvent({
      params: { formIdentifier: slug }, body: { data: { fullName: 'Listed', email: 'listed@example.com' } }, ip: '198.51.100.40',
    }))

    const result = await (submissionsHandler as Handler)(
      editorEvent({ params: { formIdentifier: id } }),
    ) as { submissions: unknown[]; total: number }
    expect(result.total).toBe(1)
  })

  it('throws 403 for author (below editor)', async () => {
    const { id } = await seedForm()
    await expect(
      (submissionsHandler as Handler)(authorEvent({ params: { formIdentifier: id } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
