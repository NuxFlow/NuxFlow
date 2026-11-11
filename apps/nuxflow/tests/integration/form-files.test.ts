/**
 * Files sent with Form Builder submissions: they're kept in R2 under the submission's own
 * private prefix, checked against the shared rules, counted towards storage, served only to
 * the site's team, and removed with their form.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent, type MockMultipartEntry } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { forms, formSubmissions } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import type * as CfEnv from '../../server/utils/cf-env'
import type * as HostingPlans from '../../server/utils/hosting-plans'
import type { StoredFormFile } from '../../shared/lib/form-files'

const r2Objects = new Map<string, { data: Uint8Array; contentType?: string }>()
let r2Available = true
const r2 = {
  put: vi.fn(async (key: string, data: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
    r2Objects.set(key, { data, contentType: opts?.httpMetadata?.contentType })
  }),
  get: vi.fn(async (key: string) => {
    const o = r2Objects.get(key)
    if (!o) return null
    return {
      size: o.data.byteLength,
      body: new Response(o.data).body,
      writeHttpMetadata: (h: Headers) => { if (o.contentType) h.set('Content-Type', o.contentType) },
    }
  }),
  delete: vi.fn(async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) r2Objects.delete(k)
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    objects: [...r2Objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })),
    truncated: false,
  })),
}

vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  getCfBindings: () => ({ kv: null, loader: null, r2: r2Available ? r2 : null }),
  waitUntil: () => {},
}))
vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/moderation', () => ({ moderateText: vi.fn().mockResolvedValue(null) }))

let storageAllowed = true
vi.mock('../../server/utils/hosting-plans', async importOriginal => ({
  ...(await importOriginal<typeof HostingPlans>()),
  checkPlanLimit: vi.fn(async () => ({ key: 'storage', allowed: storageAllowed, used: 100, max: 100 })),
}))
const mockNotice = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/plan-limit-notice', () => ({ noticePlanLimitOnce: (...a: unknown[]) => mockNotice(...a) }))

const { default: submitHandler } = await import('../../server/api/v1/forms/[formIdentifier]/submit.post')
const { default: fileHandler } = await import('../../server/routes/_nuxflow/form-file/[id].get')
const { deleteFormFiles, publicSubmissionData } = await import('../../server/utils/form-files')

const SITE = 'site-form-files-01'
const OTHER_SITE = 'site-form-files-02'
let editorId: string
let authorId: string

const FIELDS: FormField[] = [
  { id: 'f1', type: 'text', label: 'Name', name: 'name', required: true },
  { id: 'f2', type: 'file', label: 'Photos', name: 'photos', required: true },
]

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'form-files.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'form-files2.localhost' })
  editorId = await seedUser(db, { email: 'editor@form-files.test', name: 'Editor' })
  authorId = await seedUser(db, { email: 'author@form-files.test', name: 'Author' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
})
afterAll(teardownTestDb)
beforeEach(() => {
  r2Available = true
  storageAllowed = true
  mockNotice.mockClear()
})

type Handler = (e: H3Event) => Promise<unknown>

async function seedForm(fields: FormField[] = FIELDS) {
  const id = ulid()
  const slug = `quote-${id.toLowerCase()}`
  await getCurrentTestDb().insert(forms).values({ id, siteId: SITE, name: 'Quote', slug, fields, status: 'active' })
  return { id, slug }
}

const bytes = (n: number) => new Uint8Array(n).fill(7)

function multipartEvent(slug: string, data: Record<string, unknown>, files: MockMultipartEntry[]) {
  return createMockEvent({
    siteId: SITE,
    session: null,
    params: { formIdentifier: slug },
    headers: { 'content-type': 'multipart/form-data; boundary=x', 'cf-connecting-ip': '198.51.100.30' },
    multipartFormData: [
      { name: 'payload', data: new TextEncoder().encode(JSON.stringify({ data })) },
      ...files,
    ],
  }) as unknown as H3Event
}

const photo = (name = 'boiler.jpg', size = 1000): MockMultipartEntry => ({ name: 'file:photos', filename: name, type: 'image/jpeg', data: bytes(size) })

async function submissionsOf(formId: string) {
  return getCurrentTestDb().select().from(formSubmissions).where(eq(formSubmissions.formId, formId))
}

describe('submitting files', () => {
  it('keeps each file in R2 under the submission prefix and records it in the submission', async () => {
    const { id, slug } = await seedForm()
    await (submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo('boiler.jpg', 1000), photo('Tank Room.HEIC', 500)]))

    const [sub] = await submissionsOf(id)
    expect(sub.storedBytes).toBe(1500)
    expect(sub.data.name).toBe('Sam')
    const files = sub.data.photos as StoredFormFile[]
    expect(files.map(f => [f.name, f.size, f.type])).toEqual([
      ['boiler.jpg', 1000, 'image/jpeg'],
      ['Tank Room.HEIC', 500, 'image/heic'],
    ])
    for (const f of files) {
      expect(f.key.startsWith(`_private/${SITE}/forms/${id}/${sub.id}/`)).toBe(true)
      expect(r2Objects.has(f.key)).toBe(true)
    }
  })

  it('refuses a missing required file', async () => {
    const { id, slug } = await seedForm()
    await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, []))).rejects.toMatchObject({ statusCode: 422 })
    expect(await submissionsOf(id)).toHaveLength(0)
  })

  it('refuses file types a browser would run, and stores nothing', async () => {
    const { slug } = await seedForm()
    const before = r2Objects.size
    for (const name of ['drawing.svg', 'page.html', 'run.js', 'noextension']) {
      await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo(name)]))).rejects.toMatchObject({ statusCode: 422 })
    }
    expect(r2Objects.size).toBe(before)
  })

  it('refuses more than five files in a field, and files over 10 MB', async () => {
    const { slug } = await seedForm()
    const six = Array.from({ length: 6 }, (_, i) => photo(`p${i}.jpg`, 10))
    await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, six))).rejects.toMatchObject({ statusCode: 422 })
    await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo('big.jpg', 10 * 1024 * 1024 + 1)]))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('refuses a file sent for a field that is not a file field', async () => {
    const { slug } = await seedForm()
    const stray: MockMultipartEntry = { name: 'file:name', filename: 'x.jpg', data: bytes(10) }
    await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo(), stray]))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('never takes a stored-file value from the visitor\'s JSON', async () => {
    const { slug } = await seedForm()
    const forged = { name: 'Sam', photos: [{ kind: 'file', name: 'x', size: 1, type: 'image/jpeg', key: `_private/${OTHER_SITE}/secret` }] }
    await expect((submitHandler as Handler)(multipartEvent(slug, forged, [photo()]))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('accepts an empty file value from a page cached before files worked', async () => {
    const { id, slug } = await seedForm([{ id: 'f1', type: 'text', label: 'Name', name: 'name' }, { id: 'f2', type: 'file', label: 'Photo', name: 'photos' }])
    const event = createMockEvent({ siteId: SITE, session: null, params: { formIdentifier: slug }, body: { data: { name: 'Old page', photos: '' } } }) as unknown as H3Event
    await (submitHandler as Handler)(event)
    const [sub] = await submissionsOf(id)
    expect(sub.data).toEqual({ name: 'Old page' })
    expect(sub.storedBytes).toBe(0)
  })

  it('says so plainly when the site has no file storage', async () => {
    r2Available = false
    const { id, slug } = await seedForm()
    await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo()]))).rejects.toMatchObject({ statusCode: 503 })
    expect(await submissionsOf(id)).toHaveLength(0)
  })

  it('tells the admins, not the visitor, when storage is full', async () => {
    storageAllowed = false
    const { id, slug } = await seedForm()
    const before = r2Objects.size
    await expect((submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo()]))).rejects.toMatchObject({ statusCode: 507 })
    expect(mockNotice).toHaveBeenCalledWith(expect.anything(), SITE, 'storage', expect.any(String), expect.any(String))
    expect(r2Objects.size).toBe(before)
    expect(await submissionsOf(id)).toHaveLength(0)
  })

  it('hands plugins the files without their storage keys', () => {
    const out = publicSubmissionData({ name: 'Sam', photos: [{ kind: 'file', name: 'a.jpg', size: 3, type: 'image/jpeg', key: 'k' }] })
    expect(out).toEqual({ name: 'Sam', photos: [{ name: 'a.jpg', size: 3, type: 'image/jpeg' }] })
  })
})

describe('downloading a submitted file', () => {
  function fileEvent(userId: string | null, submissionId: string, field: string, n = '0') {
    return createMockEvent({
      siteId: SITE,
      session: userId ? { user: { id: userId, name: 'U', email: 'u@form-files.test' } } : null,
      params: { id: submissionId },
      query: { field, n },
    }) as unknown as H3Event
  }

  it('serves the file to an editor as a sandboxed download', async () => {
    const { id, slug } = await seedForm()
    await (submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo('boiler.jpg', 42)]))
    const [sub] = await submissionsOf(id)

    const res = await (fileHandler as Handler)(fileEvent(editorId, sub.id, 'photos')) as Response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect((await res.arrayBuffer()).byteLength).toBe(42)
  })

  it('refuses authors and visitors', async () => {
    const { id, slug } = await seedForm()
    await (submitHandler as Handler)(multipartEvent(slug, { name: 'Sam' }, [photo()]))
    const [sub] = await submissionsOf(id)
    await expect((fileHandler as Handler)(fileEvent(authorId, sub.id, 'photos'))).rejects.toMatchObject({ statusCode: 403 })
    await expect((fileHandler as Handler)(fileEvent(null, sub.id, 'photos'))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('never serves a key outside the submission\'s own prefix', async () => {
    const { id } = await seedForm()
    const subId = ulid()
    const foreignKey = `_private/${OTHER_SITE}/forms/x/y/secret.pdf`
    r2Objects.set(foreignKey, { data: bytes(5) })
    await getCurrentTestDb().insert(formSubmissions).values({
      id: subId, formId: id, siteId: SITE, status: 'new',
      data: { photos: [{ kind: 'file', name: 'secret.pdf', size: 5, type: 'application/pdf', key: foreignKey }] },
    })
    await expect((fileHandler as Handler)(fileEvent(editorId, subId, 'photos'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses another site\'s submission', async () => {
    const formId = ulid()
    const subId = ulid()
    const db = getCurrentTestDb()
    await db.insert(forms).values({ id: formId, siteId: OTHER_SITE, name: 'Other', slug: `other-${formId}`, fields: FIELDS, status: 'active' })
    const key = `_private/${OTHER_SITE}/forms/${formId}/${subId}/a.jpg`
    r2Objects.set(key, { data: bytes(5) })
    await db.insert(formSubmissions).values({
      id: subId, formId, siteId: OTHER_SITE, status: 'new',
      data: { photos: [{ kind: 'file', name: 'a.jpg', size: 5, type: 'image/jpeg', key }] },
    })
    await expect((fileHandler as Handler)(fileEvent(editorId, subId, 'photos'))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteFormFiles', () => {
  it('removes every file of the given forms and nothing else', async () => {
    const a = await seedForm()
    const b = await seedForm()
    await (submitHandler as Handler)(multipartEvent(a.slug, { name: 'A' }, [photo()]))
    await (submitHandler as Handler)(multipartEvent(b.slug, { name: 'B' }, [photo()]))

    const event = createMockEvent({ siteId: SITE }) as unknown as H3Event
    await deleteFormFiles(event, SITE, [a.id])
    const keys = [...r2Objects.keys()]
    expect(keys.some(k => k.startsWith(`_private/${SITE}/forms/${a.id}/`))).toBe(false)
    expect(keys.some(k => k.startsWith(`_private/${SITE}/forms/${b.id}/`))).toBe(true)
  })
})
