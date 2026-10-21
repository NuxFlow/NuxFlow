import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { mailingListSubscribers, siteUsageDaily } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../server/utils/edge-cache', () => ({
  purgeEdgeCache: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ messageId: 'm-1' }),
}))
vi.mock('../../server/utils/email', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmailWithConfig: mockSend,
}))

const { default: subscribe } = await import('../../server/api/public/mailing-list/subscribe.post')
const { default: confirm } = await import('../../server/api/public/mailing-list/confirm.post')
const { default: unsubscribeRoute } = await import('../../server/api/public/mailing-list/unsubscribe.post')
const { default: trackEvent } = await import('../../server/api/public/mailing-list/event.post')
const { default: listRoute } = await import('../../server/api/v1/mailing-list/index.get')
const { default: exportRoute } = await import('../../server/api/v1/mailing-list/export.get')
const { default: getSettings } = await import('../../server/api/v1/mailing-list/settings.get')
const { default: putSettings } = await import('../../server/api/v1/mailing-list/settings.put')
const { default: deleteRoute } = await import('../../server/api/v1/mailing-list/[id]/index.delete')
const { default: patchRoute } = await import('../../server/api/v1/mailing-list/[id]/index.patch')
const { default: resendRoute } = await import('../../server/api/v1/mailing-list/[id]/resend.post')
const { default: siteRoute } = await import('../../server/api/public/site.get')
const { subscriberToken, csvField, syncSubscriberToBrevo } = await import('../../server/utils/mailing-list')
const { flushUsage, pendingUsage, resetUsageBuffer } = await import('../../server/utils/usage')

// No email provider: list mail can't be sent here, so double opt-in can't be switched on.
const SITE = 'site-ml-01'
// Resend configured: double opt-in works.
const MAIL_SITE = 'site-ml-02'

let adminId: string
let editorId: string

type Handler = (e: H3Event) => Promise<unknown>

function publicEvent(siteId: string, opts: { body?: unknown; query?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId,
    body: opts.body,
    query: opts.query,
    method: 'POST',
    headers: { host: siteId === SITE ? 'ml.localhost' : 'ml2.localhost', 'cf-connecting-ip': '203.0.113.9' },
  }) as unknown as H3Event
}

function adminEvent(siteId: string, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string>; userId?: string } = {}) {
  return createMockEvent({
    siteId,
    session: { user: { id: opts.userId ?? adminId, name: 'Admin', email: 'admin@ml.test' } },
    body: opts.body,
    params: opts.params,
    query: opts.query,
    headers: { host: siteId === SITE ? 'ml.localhost' : 'ml2.localhost' },
  }) as unknown as H3Event
}

async function rowFor(siteId: string, email: string) {
  return getCurrentTestDb().query.mailingListSubscribers.findFirst({
    where: and(eq(mailingListSubscribers.siteId, siteId), eq(mailingListSubscribers.email, email)),
  })
}

async function saveSettings(siteId: string, settings: Record<string, unknown>) {
  return (putSettings as Handler)(adminEvent(siteId, { body: settings }))
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'ml.localhost' })
  await seedSite(db, { id: MAIL_SITE, domain: 'ml2.localhost' })
  adminId = await seedUser(db, { email: 'admin@ml.test', name: 'Admin' })
  editorId = await seedUser(db, { email: 'editor@ml.test', name: 'Editor' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, adminId, MAIL_SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  await seedSetting(db, MAIL_SITE, 'email.provider', 'resend')
  await seedSetting(db, MAIL_SITE, 'email.resend_api_key', 're_test_key')
})

afterAll(teardownTestDb)

beforeEach(() => {
  mockSend.mockClear()
})

describe('settings', () => {
  it('is admin only', async () => {
    await expect((getSettings as Handler)(adminEvent(SITE, { userId: editorId }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses double opt-in without a third-party email provider', async () => {
    await expect(saveSettings(SITE, { popupEnabled: true, doubleOptIn: true }))
      .rejects.toMatchObject({ statusCode: 422 })
    const res = await (getSettings as Handler)(adminEvent(SITE)) as { email: { canSendListEmail: boolean } }
    expect(res.email.canSendListEmail).toBe(false)
  })

  it('refuses a Brevo list without a Brevo key', async () => {
    await expect(saveSettings(MAIL_SITE, { doubleOptIn: true, brevoListId: 4 }))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('saves valid settings and publishes them without the reward', async () => {
    await saveSettings(SITE, {
      popupEnabled: true,
      doubleOptIn: false,
      heading: 'Join us',
      rewardText: 'Your code: WELCOME10',
      excludePaths: ['/checkout'],
    })
    const site = await (siteRoute as Handler)(adminEvent(SITE)) as { signup: Record<string, unknown> }
    expect(site.signup.popupEnabled).toBe(true)
    expect(site.signup.heading).toBe('Join us')
    expect(site.signup.excludePaths).toEqual(['/checkout'])
    expect(site.signup).not.toHaveProperty('rewardText')
    expect(site.signup).not.toHaveProperty('brevoListId')
  })
})

describe('single opt-in signup', () => {
  it('subscribes straight away and returns the reward', async () => {
    const res = await (subscribe as Handler)(publicEvent(SITE, { body: { email: '  Reader@Example.com ', source: 'popup', path: '/blog/post' } })) as { status: string; reward: { text: string } | null }
    expect(res.status).toBe('subscribed')
    expect(res.reward?.text).toBe('Your code: WELCOME10')
    const row = await rowFor(SITE, 'reader@example.com')
    expect(row).toMatchObject({ status: 'subscribed', source: 'popup', sourcePath: '/blog/post', ipAddress: '203.0.113.9' })
    expect(row?.consentText).toBeTruthy()
    expect(row?.confirmedAt).toBeTruthy()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('answers the same way for an address already on the list, without a second row', async () => {
    const res = await (subscribe as Handler)(publicEvent(SITE, { body: { email: 'reader@example.com' } })) as { status: string }
    expect(res.status).toBe('subscribed')
    const rows = await getCurrentTestDb().select().from(mailingListSubscribers)
      .where(and(eq(mailingListSubscribers.siteId, SITE), eq(mailingListSubscribers.email, 'reader@example.com')))
    expect(rows).toHaveLength(1)
  })

  it('stores nothing when the honeypot is filled', async () => {
    const res = await (subscribe as Handler)(publicEvent(SITE, { body: { email: 'bot@example.com', website: 'http://spam' } })) as { status: string }
    expect(res.status).toBe('pending')
    expect(await rowFor(SITE, 'bot@example.com')).toBeUndefined()
  })

  it('rejects an invalid address', async () => {
    await expect((subscribe as Handler)(publicEvent(SITE, { body: { email: 'not-an-email' } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('double opt-in signup', () => {
  beforeAll(async () => {
    await saveSettings(MAIL_SITE, { doubleOptIn: true, rewardUrl: '/downloads/guide.pdf', rewardLabel: 'Download' })
  })

  it('stores the address as pending and sends a confirmation email', async () => {
    const res = await (subscribe as Handler)(publicEvent(MAIL_SITE, { body: { email: 'new@example.com', name: 'Ada', source: 'block' } })) as { status: string; reward: unknown }
    expect(res).toEqual({ status: 'pending', reward: null })
    const row = await rowFor(MAIL_SITE, 'new@example.com')
    expect(row).toMatchObject({ status: 'pending', name: 'Ada', source: 'block' })
    expect(row?.confirmSentAt).toBeTruthy()
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [config, msg] = mockSend.mock.calls[0]! as [{ emailProvider: string }, { to: string; category: string; html: string }]
    expect(config.emailProvider).toBe('resend')
    expect(msg.to).toBe('new@example.com')
    expect(msg.category).toBe('mailing_list')
    expect(msg.html).toContain('/mailing-list/confirm?id=')
  })

  it('does not resend the confirmation within ten minutes', async () => {
    await (subscribe as Handler)(publicEvent(MAIL_SITE, { body: { email: 'new@example.com' } }))
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('refuses a wrong or cross-purpose token', async () => {
    const row = await rowFor(MAIL_SITE, 'new@example.com')
    const unsubToken = await subscriberToken('unsubscribe', MAIL_SITE, row!.id)
    await expect((confirm as Handler)(publicEvent(MAIL_SITE, { body: { id: row!.id, token: unsubToken } })))
      .rejects.toMatchObject({ statusCode: 404 })
    // A token for the same id on another site is no good either.
    const otherSite = await subscriberToken('confirm', SITE, row!.id)
    await expect((confirm as Handler)(publicEvent(MAIL_SITE, { body: { id: row!.id, token: otherSite } })))
      .rejects.toMatchObject({ statusCode: 404 })
    expect((await rowFor(MAIL_SITE, 'new@example.com'))?.status).toBe('pending')
  })

  it('confirms with the right token and reveals the reward', async () => {
    const row = await rowFor(MAIL_SITE, 'new@example.com')
    const token = await subscriberToken('confirm', MAIL_SITE, row!.id)
    const res = await (confirm as Handler)(publicEvent(MAIL_SITE, { body: { id: row!.id, token } })) as { reward: { url: string; label: string } }
    expect(res.reward).toMatchObject({ url: '/downloads/guide.pdf', label: 'Download' })
    const after = await rowFor(MAIL_SITE, 'new@example.com')
    expect(after?.status).toBe('subscribed')
    expect(after?.confirmedAt).toBeTruthy()
  })

  it('unsubscribes by one-click link (token in the query) and an old confirm link does not undo it', async () => {
    const row = await rowFor(MAIL_SITE, 'new@example.com')
    const unsub = await subscriberToken('unsubscribe', MAIL_SITE, row!.id)
    await (unsubscribeRoute as Handler)(publicEvent(MAIL_SITE, { query: { id: row!.id, token: unsub }, body: 'List-Unsubscribe=One-Click' }))
    expect((await rowFor(MAIL_SITE, 'new@example.com'))?.status).toBe('unsubscribed')

    const confirmToken = await subscriberToken('confirm', MAIL_SITE, row!.id)
    const res = await (confirm as Handler)(publicEvent(MAIL_SITE, { body: { id: row!.id, token: confirmToken } })) as { reward: unknown }
    expect(res.reward).toBeNull()
    expect((await rowFor(MAIL_SITE, 'new@example.com'))?.status).toBe('unsubscribed')
  })

  it('signing up again after unsubscribing goes back through confirmation', async () => {
    await getCurrentTestDb().update(mailingListSubscribers).set({ confirmSentAt: null })
      .where(eq(mailingListSubscribers.siteId, MAIL_SITE))
    const res = await (subscribe as Handler)(publicEvent(MAIL_SITE, { body: { email: 'new@example.com' } })) as { status: string }
    expect(res.status).toBe('pending')
    expect((await rowFor(MAIL_SITE, 'new@example.com'))?.status).toBe('pending')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('keeps the row pending when sending fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('provider down'))
    const res = await (subscribe as Handler)(publicEvent(MAIL_SITE, { body: { email: 'fails@example.com' } })) as { status: string }
    expect(res.status).toBe('pending')
    const row = await rowFor(MAIL_SITE, 'fails@example.com')
    expect(row?.status).toBe('pending')
    expect(row?.confirmSentAt).toBeNull()
  })
})

describe('admin', () => {
  it('lists the current site only, with counts and search', async () => {
    const res = await (listRoute as Handler)(adminEvent(SITE)) as { items: { email: string }[]; counts: Record<string, number>; canSendListEmail: boolean }
    expect(res.items.map(i => i.email)).toEqual(['reader@example.com'])
    expect(res.counts.subscribed).toBe(1)
    expect(res.canSendListEmail).toBe(false)

    const search = await (listRoute as Handler)(adminEvent(MAIL_SITE, { query: { q: 'FAILS' } })) as { items: { email: string }[] }
    expect(search.items.map(i => i.email)).toEqual(['fails@example.com'])

    // LIKE wildcards in the search box match literally.
    const wildcard = await (listRoute as Handler)(adminEvent(MAIL_SITE, { query: { q: '%' } })) as { items: unknown[] }
    expect(wildcard.items).toHaveLength(0)
  })

  it('is admin only', async () => {
    await expect((listRoute as Handler)(adminEvent(SITE, { userId: editorId }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('resends a confirmation only to pending people, and only with a provider', async () => {
    const pending = await rowFor(MAIL_SITE, 'fails@example.com')
    await (resendRoute as Handler)(adminEvent(MAIL_SITE, { params: { id: pending!.id } }))
    expect(mockSend).toHaveBeenCalledTimes(1)

    const subscribed = await rowFor(SITE, 'reader@example.com')
    await expect((resendRoute as Handler)(adminEvent(SITE, { params: { id: subscribed!.id } })))
      .rejects.toMatchObject({ statusCode: 409 })
    // Another site's row is invisible.
    await expect((resendRoute as Handler)(adminEvent(SITE, { params: { id: pending!.id } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('exports CSV with formula characters neutralised', async () => {
    await getCurrentTestDb().insert(mailingListSubscribers).values({
      id: '01MLEXPORT0000000000000000', siteId: SITE, email: 'calc@example.com', name: '=HYPERLINK("x")', status: 'subscribed',
    })
    vi.stubGlobal('sendStream', (_e: unknown, stream: ReadableStream) => stream)
    const stream = await (exportRoute as Handler)(adminEvent(SITE)) as ReadableStream<Uint8Array>
    const text = await new Response(stream).text()
    vi.unstubAllGlobals()
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toBe('email,name,status,source,signed_up,confirmed,unsubscribed,consent_text')
    expect(lines).toHaveLength(3)
    expect(text).toContain('"\'=HYPERLINK(""x"")"')
    expect(text).not.toContain('fails@example.com')
  })

  it('unsubscribes and deletes', async () => {
    const row = await rowFor(SITE, 'calc@example.com')
    await (patchRoute as Handler)(adminEvent(SITE, { params: { id: row!.id }, body: { status: 'unsubscribed' } }))
    expect((await rowFor(SITE, 'calc@example.com'))?.status).toBe('unsubscribed')
    await expect((patchRoute as Handler)(adminEvent(SITE, { params: { id: row!.id }, body: { status: 'subscribed' } })))
      .rejects.toMatchObject({ statusCode: 422 })

    await (deleteRoute as Handler)(adminEvent(SITE, { params: { id: row!.id } }))
    expect(await rowFor(SITE, 'calc@example.com')).toBeUndefined()
    await expect((deleteRoute as Handler)(adminEvent(SITE, { params: { id: row!.id } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('reports popup statistics', async () => {
    resetUsageBuffer()
    await (trackEvent as Handler)(publicEvent(SITE, { body: { type: 'shown' } }))
    await (trackEvent as Handler)(publicEvent(SITE, { body: { type: 'shown' } }))
    await (trackEvent as Handler)(publicEvent(SITE, { body: { type: 'dismissed' } }))
    await flushUsage(getCurrentTestDb(), pendingUsage())
    resetUsageBuffer()
    const rows = await getCurrentTestDb().select().from(siteUsageDaily).where(eq(siteUsageDaily.siteId, SITE))
    expect(rows.length).toBeGreaterThan(0)

    const res = await (listRoute as Handler)(adminEvent(SITE)) as { stats: { shown: number; dismissed: number; signups: number } }
    expect(res.stats.shown).toBeGreaterThanOrEqual(2)
    expect(res.stats.dismissed).toBeGreaterThanOrEqual(1)
    expect(res.stats.signups).toBe(1)
  })
})

describe('Brevo sync', () => {
  it('adds a subscribed contact to the list and records failures', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'email.brevo_api_key', 'xkeysib-test')
    const row = await rowFor(SITE, 'reader@example.com')
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 201 }))
      .mockResolvedValueOnce(new Response('bad key', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await syncSubscriberToBrevo(adminEvent(SITE), 7, SITE, row!.id)
      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
      expect(url).toBe('https://api.brevo.com/v3/contacts')
      expect(JSON.parse(init.body as string)).toMatchObject({ email: 'reader@example.com', listIds: [7], updateEnabled: true })
      expect((await rowFor(SITE, 'reader@example.com'))?.syncedAt).toBeTruthy()

      await syncSubscriberToBrevo(adminEvent(SITE), 7, SITE, row!.id)
      expect((await rowFor(SITE, 'reader@example.com'))?.syncError).toContain('Brevo 401')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('csvField', () => {
  it('quotes and neutralises', () => {
    expect(csvField('a"b')).toBe('"a""b"')
    expect(csvField('+1 555')).toBe('"\'+1 555"')
    expect(csvField(null)).toBe('""')
  })
})
