import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { PREVIEW_COOKIE } from '../../server/utils/preview'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: previewLinkHandler } = await import('../../server/api/v1/content/[id]/preview-link.post')
const { default: previewTokenHandler } = await import('../../server/api/preview/[token].get')
const { default: pageHandler } = await import('../../server/api/public/pages/[slug].get')

const SITE = 'site-preview-01'
let authorId: string
let typeId: string
let draftId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'preview.localhost' })
  authorId = await seedUser(db, { email: 'author@preview.test' })
  await seedRole(db, authorId, SITE, 'author')
  typeId = await seedContentType(db, SITE)
  draftId = await seedContentItem(db, SITE, typeId, {
    authorId, slug: 'upcoming-post', title: 'Upcoming Post', status: 'draft', publishedAt: null,
  })
  await seedContentItem(db, SITE, typeId, { slug: 'other-draft', title: 'Other Draft', status: 'draft', publishedAt: null })
})
afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

async function generateToken(): Promise<{ url: string; token: string }> {
  const { url } = await (previewLinkHandler as Handler)(createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@preview.test' } },
    params: { id: draftId },
    headers: { host: 'preview.localhost' },
  }) as unknown as H3Event) as { url: string }
  return { url, token: url.split('/').pop()! }
}

function pageRequest(slug: string, cookies: Record<string, string> = {}) {
  return createMockEvent({ siteId: SITE, params: { slug }, cookies }) as unknown as H3Event & {
    _responseHeaders: Record<string, string>
  }
}

describe('draft preview links', () => {
  // The link has to point at the site the token belongs to — on a multi-site install the
  // deployment-wide siteUrl is some other site's domain.
  it('builds the preview link on the requesting site\'s own origin', async () => {
    const { url } = await generateToken()
    expect(url.startsWith('http://preview.localhost/api/preview/')).toBe(true)
  })

  it('sets an HttpOnly preview cookie and redirects to the item', async () => {
    const { token } = await generateToken()
    const setCookieSpy = vi.spyOn(globalThis as unknown as { setCookie: (...a: unknown[]) => void }, 'setCookie')
    const event = createMockEvent({ siteId: SITE, params: { token }, headers: { host: 'preview.localhost' } })
    await (previewTokenHandler as Handler)(event as unknown as H3Event)

    expect(setCookieSpy).toHaveBeenCalledWith(expect.anything(), PREVIEW_COOKIE, token, expect.objectContaining({ httpOnly: true }))
    expect(event._redirect).toEqual({ url: '/upcoming-post', code: 302 })
    setCookieSpy.mockRestore()
  })

  it('does not serve a draft without the preview cookie', async () => {
    await expect((pageHandler as Handler)(pageRequest('upcoming-post'))).rejects.toMatchObject({ statusCode: 404 })
  })

  // Previously the cookie was set but never read, so preview links always 404'd.
  it('serves the draft to a browser holding a valid preview cookie, uncached and noindex', async () => {
    const { token } = await generateToken()
    const event = pageRequest('upcoming-post', { [PREVIEW_COOKIE]: token })
    const page = await (pageHandler as Handler)(event) as { title: string }

    expect(page.title).toBe('Upcoming Post')
    expect(event._responseHeaders['Cache-Control']).toBe('private, no-store')
    expect(event._responseHeaders['X-Robots-Tag']).toBe('noindex')
  })

  it('does not let one item\'s token unlock a different draft', async () => {
    const { token } = await generateToken()
    await expect(
      (pageHandler as Handler)(pageRequest('other-draft', { [PREVIEW_COOKIE]: token })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects an expired token', async () => {
    const { token } = await generateToken()
    await getCurrentTestDb().update(contentItems)
      .set({ previewTokenExpiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(contentItems.id, draftId))
    await expect(
      (pageHandler as Handler)(pageRequest('upcoming-post', { [PREVIEW_COOKIE]: token })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
