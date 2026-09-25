/**
 * Admin inbox, mailbox management, post-by-email address, and notification preference
 * routes — permissions, validation, reply addressing/threading, and preference effects on
 * sendNotification().
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { emailMessages, mailboxes, notificationPreferences } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))

const { mockSend, mockTemplated, mockPush } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ messageId: 'reply-1@acme.test' }),
  mockTemplated: vi.fn().mockResolvedValue({}),
  mockPush: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/email', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmailWithConfig: mockSend,
}))
vi.mock('../../server/utils/email-template', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTemplatedEmail: mockTemplated,
}))
vi.mock('../../server/utils/webpush', () => ({ sendPushToUser: mockPush }))

const { default: listInbox } = await import('../../server/api/v1/inbox/index.get')
const { default: getMessage } = await import('../../server/api/v1/inbox/[id].get')
const { default: patchMessage } = await import('../../server/api/v1/inbox/[id].patch')
const { default: deleteMessage } = await import('../../server/api/v1/inbox/[id].delete')
const { default: replyToMessage } = await import('../../server/api/v1/inbox/[id]/reply.post')
const { default: listMailboxes } = await import('../../server/api/v1/mailboxes/index.get')
const { default: createMailbox } = await import('../../server/api/v1/mailboxes/index.post')
const { default: deleteMailbox } = await import('../../server/api/v1/mailboxes/[id].delete')
const { default: getPostAddress } = await import('../../server/api/v1/account/post-address/index.get')
const { default: createPostAddress } = await import('../../server/api/v1/account/post-address/index.post')
const { default: getPrefs } = await import('../../server/api/v1/account/notification-preferences/index.get')
const { default: putPrefs } = await import('../../server/api/v1/account/notification-preferences/index.put')
const { sendNotification } = await import('../../server/utils/notify')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-inbox-routes-01'
const OTHER = 'site-inbox-routes-02'
let adminId: string
let editorId: string
let authorId: string
let mailboxId: string

function ev(userId: string, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string>; siteId?: string } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    body: opts.body,
    params: opts.params,
    query: opts.query,
    headers: { host: 'acme.test' },
  }) as unknown as H3Event
}

async function seedInbound(overrides: Partial<typeof emailMessages.$inferInsert> = {}) {
  const id = ulid()
  await getCurrentTestDb().insert(emailMessages).values({
    id,
    siteId: SITE,
    mailboxId,
    threadId: id,
    direction: 'inbound',
    messageId: `<${id}@example.org>`,
    fromAddress: 'jane@example.org',
    fromName: 'Jane',
    toAddress: 'contact@acme.test',
    subject: 'Question',
    snippet: 'Hello',
    textBody: 'Hello there\nsecond line',
    ...overrides,
  })
  return id
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'acme.test', name: 'Acme' })
  await seedSite(db, { id: OTHER, domain: 'other.test' })
  adminId = await seedUser(db, { email: 'admin@acme.test' })
  editorId = await seedUser(db, { email: 'editor@acme.test' })
  authorId = await seedUser(db, { email: 'author@acme.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  mailboxId = ulid()
  await db.insert(mailboxes).values({ id: mailboxId, siteId: SITE, localPart: 'contact', name: 'Contact' })
})

afterAll(teardownTestDb)

beforeEach(async () => {
  await getCurrentTestDb().delete(emailMessages)
  mockSend.mockClear()
  mockTemplated.mockClear()
  mockPush.mockClear()
})

describe('inbox routes', () => {
  it('lets editors read the inbox but not authors', async () => {
    await seedInbound()
    const res = await (listInbox as Handler)(ev(editorId)) as { messages: unknown[]; unread: number }
    expect(res.messages).toHaveLength(1)
    expect(res.unread).toBe(1)
    await expect((listInbox as Handler)(ev(authorId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('never lists another site\'s mail, or post-by-email records', async () => {
    const db = getCurrentTestDb()
    await seedInbound()
    const otherBox = ulid()
    await db.insert(mailboxes).values({ id: otherBox, siteId: OTHER, localPart: 'contact', name: 'Other' })
    await db.insert(emailMessages).values({ id: ulid(), siteId: OTHER, mailboxId: otherBox, threadId: 'x', direction: 'inbound', fromAddress: 'a@b.c', toAddress: 'contact@other.test' })
    const postBox = ulid()
    await db.insert(mailboxes).values({ id: postBox, siteId: SITE, localPart: 'post-abcabcabcabcabcabcabcabc', name: 'Post', kind: 'post', userId: authorId })
    await seedInbound({ mailboxId: postBox, contentItemId: 'draft-1', status: 'read' })

    const res = await (listInbox as Handler)(ev(editorId)) as { messages: { mailboxId: string }[] }
    expect(res.messages.map(m => m.mailboxId)).toEqual([mailboxId])
  })

  it('filters by folder and search term', async () => {
    await seedInbound({ subject: 'Invoice overdue' })
    await seedInbound({ subject: 'Buy backlinks', status: 'spam' })
    const inbox = await (listInbox as Handler)(ev(editorId)) as { messages: { subject: string }[] }
    expect(inbox.messages.map(m => m.subject)).toEqual(['Invoice overdue'])
    const spam = await (listInbox as Handler)(ev(editorId, { query: { folder: 'spam' } })) as { messages: { subject: string }[] }
    expect(spam.messages.map(m => m.subject)).toEqual(['Buy backlinks'])
    const searched = await (listInbox as Handler)(ev(editorId, { query: { q: 'invoice' } })) as { messages: unknown[] }
    expect(searched.messages).toHaveLength(1)
  })

  it('opening a message marks it read and returns its thread without storage keys', async () => {
    const id = await seedInbound({ attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', size: 3, key: '_private/secret-key' }] })
    const res = await (getMessage as Handler)(ev(editorId, { params: { id } })) as { message: { status: string }; thread: { attachments: Record<string, unknown>[] }[] }
    expect(res.message.status).toBe('read')
    expect(JSON.stringify(res)).not.toContain('_private/secret-key')
    expect(res.thread[0]!.attachments[0]).toMatchObject({ index: 0, filename: 'a.pdf', available: true })
    const row = await getCurrentTestDb().query.emailMessages.findFirst({ where: eq(emailMessages.id, id) })
    expect(row!.status).toBe('read')
  })

  it('404s a message id from another site, even for an editor of that site', async () => {
    const id = await seedInbound()
    const otherEditor = await seedUser(getCurrentTestDb(), { email: 'editor@other.test' })
    await seedRole(getCurrentTestDb(), otherEditor, OTHER, 'editor')
    await expect((getMessage as Handler)(ev(otherEditor, { siteId: OTHER, params: { id } }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('changes status, and only admins can delete', async () => {
    const id = await seedInbound()
    await (patchMessage as Handler)(ev(editorId, { params: { id }, body: { status: 'archived' } }))
    expect((await getCurrentTestDb().query.emailMessages.findFirst({ where: eq(emailMessages.id, id) }))!.status).toBe('archived')
    await expect((deleteMessage as Handler)(ev(editorId, { params: { id } }))).rejects.toMatchObject({ statusCode: 403 })
    await (deleteMessage as Handler)(ev(adminId, { params: { id } }))
    expect(await getCurrentTestDb().query.emailMessages.findFirst({ where: eq(emailMessages.id, id) })).toBeUndefined()
  })
})

describe('replying', () => {
  it('replies from the address the mail arrived at, threaded, and stores the reply', async () => {
    const id = await seedInbound({ toAddress: 'contact+sales@acme.test', subject: 'Question' })
    await (replyToMessage as Handler)(ev(editorId, { params: { id }, body: { body: 'Thanks!\n\nIt costs £5.' } }))

    const [config, msg] = mockSend.mock.calls[0] as [unknown, { to: string; from?: string; replyTo?: string; subject: string; headers: Record<string, string>; text: string }]
    expect(config).toBeDefined()
    expect(msg).toMatchObject({ to: 'jane@example.org', from: 'contact@acme.test', subject: 'Re: Question', category: 'inbox_reply' })
    expect(msg.replyTo).toBeUndefined()
    expect(msg.headers['In-Reply-To']).toBe(`<${id}@example.org>`)
    expect(msg.text).toContain('> Hello there')

    const reply = await getCurrentTestDb().query.emailMessages.findFirst({ where: and(eq(emailMessages.threadId, id), eq(emailMessages.direction, 'outbound')) })
    expect(reply).toMatchObject({ toAddress: 'jane@example.org', sentByUserId: editorId, messageId: '<reply-1@acme.test>' })
  })

  it('replies to platform-domain mail from the site sender with Reply-To set back to the alias', async () => {
    const id = await seedInbound({ toAddress: 'acme+contact@in.platform.test' })
    await (replyToMessage as Handler)(ev(editorId, { params: { id }, body: { body: 'Hi', quote: false } }))
    const [, msg] = mockSend.mock.calls[0] as [unknown, { from?: string; replyTo?: string; text: string }]
    expect(msg.from).toBeUndefined()
    expect(msg.replyTo).toBe('acme+contact@in.platform.test')
    expect(msg.text).toBe('Hi')
  })

  it('reports a delivery failure as 502 and stores nothing', async () => {
    const id = await seedInbound()
    mockSend.mockRejectedValueOnce(new Error('E_SENDER_NOT_VERIFIED'))
    await expect((replyToMessage as Handler)(ev(editorId, { params: { id }, body: { body: 'Hi' } })))
      .rejects.toMatchObject({ statusCode: 502 })
    const rows = await getCurrentTestDb().query.emailMessages.findMany({ where: eq(emailMessages.direction, 'outbound') })
    expect(rows).toHaveLength(0)
  })
})

describe('mailbox routes', () => {
  it('is admin-only', async () => {
    await expect((listMailboxes as Handler)(ev(editorId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates addresses, rejecting reserved, duplicate and malformed ones', async () => {
    await (createMailbox as Handler)(ev(adminId, { body: { localPart: 'Leads', name: 'Leads' } }))
    const res = await (listMailboxes as Handler)(ev(adminId)) as { mailboxes: { localPart: string; siteAddress: string }[] }
    expect(res.mailboxes.find(m => m.localPart === 'leads')?.siteAddress).toBe('leads@acme.test')

    await expect((createMailbox as Handler)(ev(adminId, { body: { localPart: 'leads', name: 'Again' } }))).rejects.toMatchObject({ statusCode: 409 })
    await expect((createMailbox as Handler)(ev(adminId, { body: { localPart: 'postmaster', name: 'x' } }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((createMailbox as Handler)(ev(adminId, { body: { localPart: 'post-sneaky', name: 'x' } }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((createMailbox as Handler)(ev(adminId, { body: { localPart: 'a b', name: 'x' } }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('keeps a deleted mailbox\'s messages but detaches them', async () => {
    const db = getCurrentTestDb()
    const boxId = ulid()
    await db.insert(mailboxes).values({ id: boxId, siteId: SITE, localPart: 'temp', name: 'Temp' })
    const msgId = await seedInbound({ mailboxId: boxId })
    await (deleteMailbox as Handler)(ev(adminId, { params: { id: boxId } }))
    const row = await db.query.emailMessages.findFirst({ where: eq(emailMessages.id, msgId) })
    expect(row!.mailboxId).toBeNull()
  })
})

describe('post-by-email address', () => {
  it('is for authors and up, and rotating replaces the old address', async () => {
    const db = getCurrentTestDb()
    const writer = await seedUser(db, { email: 'writer@acme.test' })
    const member = await seedUser(db, { email: 'member@acme.test' })
    await seedRole(db, writer, SITE, 'author')
    await seedRole(db, member, SITE, 'member')
    await expect((getPostAddress as Handler)(ev(member))).rejects.toMatchObject({ statusCode: 403 })
    expect(await (getPostAddress as Handler)(ev(writer))).toMatchObject({ address: null })

    const first = await (createPostAddress as Handler)(ev(writer)) as { address: { siteAddress: string } }
    expect(first.address.siteAddress).toMatch(/^post-[a-z2-9]{24}@acme\.test$/)
    const second = await (createPostAddress as Handler)(ev(writer)) as { address: { siteAddress: string } }
    expect(second.address.siteAddress).not.toBe(first.address.siteAddress)

    const rows = await db.query.mailboxes.findMany({ where: and(eq(mailboxes.userId, writer), eq(mailboxes.kind, 'post')) })
    expect(rows).toHaveLength(1)
  })
})

describe('notification preferences', () => {
  it('shows only types relevant to the caller\'s role', async () => {
    const author = await (getPrefs as Handler)(ev(authorId)) as { preferences: { type: string }[] }
    const types = author.preferences.map(p => p.type)
    expect(types).toContain('security.new_sign_in')
    expect(types).toContain('content.post_by_email')
    expect(types).not.toContain('inbox.message')
    expect(types).not.toContain('system.plugin_installed')
  })

  it('an opt-out stops the email but keeps the in-app row; security email cannot be turned off', async () => {
    await (putPrefs as Handler)(ev(editorId, { body: { preferences: [
      { type: 'inbox.message', email: false, push: true },
      { type: 'security.role_changed', email: false, push: false },
      { type: 'not.a.real.type', email: false, push: false },
    ] } }))
    const saved = await getCurrentTestDb().query.notificationPreferences.findMany({ where: eq(notificationPreferences.userId, editorId) })
    expect(saved.map(p => p.type).sort()).toEqual(['inbox.message', 'security.role_changed'])

    await sendNotification({ siteId: SITE, userId: editorId, type: 'inbox.message', title: 'New email', body: 'x', sendEmailNotification: true, sendPush: true }, ev(editorId))
    expect(mockTemplated).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledTimes(1)

    await sendNotification({ siteId: SITE, userId: editorId, type: 'security.role_changed', title: 'Role changed', body: 'x', sendEmailNotification: true, sendPush: true }, ev(editorId))
    expect(mockTemplated).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledTimes(1)

    const prefs = await (getPrefs as Handler)(ev(editorId)) as { preferences: { type: string; email: boolean; emailLocked: boolean }[] }
    expect(prefs.preferences.find(p => p.type === 'security.role_changed')).toMatchObject({ email: true, emailLocked: true })
  })
})
