/**
 * The inbound pipeline end to end against a real SQLite database: recipient resolution
 * (site domain, catch-all, platform handle), MIME parsing, storage, threading, dedupe,
 * AI triage, team notification, R2 storage, and email-to-draft with its three auth checks.
 * Only the edges are faked: the Cloudflare message object, R2, the media provider, the AI
 * model, and outgoing email/push.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedSetting } from '../helpers/seed'
import { contentItems, emailMessages, mailboxes, media, notifications } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/system-event', () => ({
  createSystemEvent: (opts: { env: unknown; siteId?: string; host?: string }) => {
    const event = createMockEvent({ siteId: opts.siteId, headers: { host: opts.host ?? 'localhost' } }) as unknown as { context: Record<string, unknown> }
    if (!opts.siteId) delete event.context.siteId
    event.context.cloudflare = { env: opts.env, context: { waitUntil: (p: Promise<unknown>) => { void p } } }
    return event
  },
}))

const { mockEmail, mockPush, mockModel, mockGenerateObject, mockUpload } = vi.hoisted(() => ({
  mockEmail: vi.fn().mockResolvedValue({}),
  mockPush: vi.fn().mockResolvedValue(undefined),
  mockModel: vi.fn().mockResolvedValue(null),
  mockGenerateObject: vi.fn(),
  mockUpload: vi.fn(async (_file: File, key: string) => ({ url: `https://cdn.test/${key}`, storageKey: key, provider: 'r2' })),
}))
vi.mock('../../server/utils/email-template', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTemplatedEmail: mockEmail,
}))
vi.mock('../../server/utils/webpush', () => ({ sendPushToUser: mockPush }))
vi.mock('../../server/utils/ai-sdk', () => ({
  getAiSdkModel: mockModel,
  callAiOrThrow: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateObject: mockGenerateObject,
}))
vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: async () => ({ name: 'r2', upload: mockUpload, delete: vi.fn(), getUrl: (k: string) => k }),
}))

const { handleInboundEmail } = await import('../../server/utils/inbound-email')

const SITE = 'site-inbound-01'
const PLATFORM = 'in.platform.test'
let editorId: string
let adminId: string
let authorId: string
let inboxId: string

const bucket = new Map<string, unknown>()
const env = {
  MEDIA_BUCKET: {
    put: vi.fn(async (key: string, value: unknown) => { bucket.set(key, value) }),
    get: vi.fn(),
    delete: vi.fn(),
  },
}
const realRuntimeConfig = globalThis.useRuntimeConfig

function mime(opts: {
  from?: string
  to?: string
  subject?: string
  messageId?: string
  inReplyTo?: string
  text?: string
  html?: string
  attachments?: { filename: string; type: string; base64: string; contentId?: string }[]
}): string {
  const headers = [
    `From: ${opts.from ?? 'Jane Doe <jane@example.org>'}`,
    `To: ${opts.to ?? 'contact@acme.test'}`,
    `Subject: ${opts.subject ?? 'Pricing question'}`,
    `Message-ID: ${opts.messageId ?? `<${ulid()}@example.org>`}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    'Date: Thu, 25 Sep 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
  ]
  const text = opts.text ?? 'Hello, how much is it?'
  if (!opts.html && !opts.attachments?.length) {
    return [...headers, 'Content-Type: text/plain; charset=utf-8', '', text, ''].join('\r\n')
  }
  const b = 'BOUNDARY42'
  const parts = [
    `--${b}\r\nContent-Type: ${opts.html ? 'text/html' : 'text/plain'}; charset=utf-8\r\n\r\n${opts.html ?? text}\r\n`,
    ...(opts.attachments ?? []).map(a =>
      `--${b}\r\nContent-Type: ${a.type}; name="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n${a.contentId ? `Content-ID: <${a.contentId}>\r\nContent-Disposition: inline; filename="${a.filename}"` : `Content-Disposition: attachment; filename="${a.filename}"`}\r\n\r\n${a.base64}\r\n`),
  ]
  return [...headers, `Content-Type: multipart/mixed; boundary="${b}"`, '', ...parts, `--${b}--`, ''].join('\r\n')
}

function message(raw: string, envelope: { from?: string; to?: string; auth?: string } = {}) {
  const bytes = new TextEncoder().encode(raw)
  return {
    from: envelope.from ?? 'jane@example.org',
    to: envelope.to ?? 'contact@acme.test',
    rawSize: bytes.byteLength,
    raw: new Response(bytes).body!,
    headers: new Headers(envelope.auth ? { 'authentication-results': envelope.auth } : {}),
    setReject: vi.fn(),
    forward: vi.fn().mockResolvedValue({}),
    reply: vi.fn(),
    canBeForwarded: true,
  } as unknown as ForwardableEmailMessage & { setReject: ReturnType<typeof vi.fn>; forward: ReturnType<typeof vi.fn> }
}

const ctx = { waitUntil: (p: Promise<unknown>) => { void p } }
const receive = (m: ReturnType<typeof message>) => handleInboundEmail(m, env, ctx)

async function inboxRows() {
  return getCurrentTestDb().query.emailMessages.findMany({ where: eq(emailMessages.siteId, SITE), orderBy: (m, { asc }) => [asc(m.createdAt), asc(m.id)] })
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'www.acme.test', name: 'Acme' })
  editorId = await seedUser(db, { email: 'editor@acme.test' })
  adminId = await seedUser(db, { email: 'admin@acme.test' })
  authorId = await seedUser(db, { email: 'author@example.org' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, authorId, SITE, 'author')
  await seedContentType(db, SITE, { slug: 'post', name: 'Post' })
  inboxId = ulid()
  await db.insert(mailboxes).values({ id: inboxId, siteId: SITE, localPart: 'contact', name: 'Contact', forwardTo: 'owner@gmail.test' })
})

afterAll(teardownTestDb)

beforeEach(async () => {
  const db = getCurrentTestDb()
  await db.delete(emailMessages)
  await db.delete(notifications)
  bucket.clear()
  mockEmail.mockClear()
  mockPush.mockClear()
  mockUpload.mockClear()
  mockModel.mockResolvedValue(null)
  mockGenerateObject.mockReset()
})

afterEach(() => {
  globalThis.useRuntimeConfig = realRuntimeConfig
})

describe('inbox delivery', () => {
  it('stores a message sent to the site domain (configured as www.) and tells the team', async () => {
    const m = message(mime({ subject: 'Pricing question' }))
    await receive(m)

    const [row] = await inboxRows()
    expect(row).toMatchObject({
      mailboxId: inboxId,
      direction: 'inbound',
      fromAddress: 'jane@example.org',
      fromName: 'Jane Doe',
      toAddress: 'contact@acme.test',
      subject: 'Pricing question',
      status: 'new',
    })
    expect(row!.threadId).toBe(row!.id)
    expect(row!.textBody).toContain('how much')
    expect(row!.rawKey).toMatch(/^_private\/site-inbound-01\/email\//)
    expect(bucket.has(row!.rawKey!)).toBe(true)

    // Forwarded to the mailbox's verified address.
    expect(m.forward).toHaveBeenCalledWith('owner@gmail.test')

    // Editor and admin both get an in-app row; the author (below editor) does not.
    const notes = await getCurrentTestDb().query.notifications.findMany({ where: eq(notifications.type, 'inbox.message') })
    expect(notes.map(n => n.userId).sort()).toEqual([editorId, adminId].sort())
    expect(mockEmail).toHaveBeenCalledTimes(2)
  })

  it('ignores an unknown address (and tries to reject it)', async () => {
    const m = message(mime({}), { to: 'nobody@acme.test' })
    await receive(m)
    expect(await inboxRows()).toHaveLength(0)
    expect(m.setReject).toHaveBeenCalled()
  })

  it('routes unmatched addresses to a catch-all mailbox when one exists', async () => {
    const db = getCurrentTestDb()
    const catchAllId = ulid()
    await db.insert(mailboxes).values({ id: catchAllId, siteId: SITE, localPart: '*', name: 'Everything else', notify: false })
    try {
      await receive(message(mime({}), { to: 'random@acme.test' }))
      const [row] = await inboxRows()
      expect(row!.mailboxId).toBe(catchAllId)
      expect(mockEmail).not.toHaveBeenCalled()
    }
    finally {
      await db.delete(mailboxes).where(eq(mailboxes.id, catchAllId))
    }
  })

  it('does not store a redelivery of the same Message-ID twice', async () => {
    const raw = mime({ messageId: '<dup-1@example.org>' })
    await receive(message(raw))
    await receive(message(raw))
    expect(await inboxRows()).toHaveLength(1)
  })

  it('threads a reply by In-Reply-To, and by subject when the reference is unknown', async () => {
    await receive(message(mime({ messageId: '<first@example.org>', subject: 'Order 42' })))
    await receive(message(mime({ inReplyTo: '<first@example.org>', subject: 'Re: Order 42' })))
    await receive(message(mime({ inReplyTo: '<opaque-provider-id>', subject: 'RE: re: Order 42' })))
    await receive(message(mime({ subject: 'Something else' })))

    const rows = await inboxRows()
    expect(rows).toHaveLength(4)
    const [first, second, third, fourth] = rows
    expect(second!.threadId).toBe(first!.id)
    expect(third!.threadId).toBe(first!.id)
    expect(fourth!.threadId).toBe(fourth!.id)
  })

  it('stores attachments privately in R2 with their metadata', async () => {
    await receive(message(mime({ attachments: [{ filename: 'quote.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64') }] })))
    const [row] = await inboxRows()
    expect(row!.attachments).toHaveLength(1)
    expect(row!.attachments![0]).toMatchObject({ filename: 'quote.pdf', contentType: 'application/pdf', size: 13 })
    expect(row!.attachments![0]!.key).toMatch(/^_private\//)
  })

  it('files AI-flagged spam straight into Spam without notifying anyone', async () => {
    mockModel.mockResolvedValue({})
    mockGenerateObject.mockResolvedValue({ object: { category: 'spam', summary: 'SEO pitch' } })
    await receive(message(mime({ subject: 'Rank #1 on Google' })))
    const [row] = await inboxRows()
    expect(row).toMatchObject({ status: 'spam', category: 'spam', aiSummary: 'SEO pitch' })
    expect(mockEmail).not.toHaveBeenCalled()
  })

  it('labels a lead and still notifies', async () => {
    mockModel.mockResolvedValue({})
    mockGenerateObject.mockResolvedValue({ object: { category: 'lead', summary: 'Wants a quote for 200 cakes' } })
    await receive(message(mime({})))
    const [row] = await inboxRows()
    expect(row).toMatchObject({ status: 'new', category: 'lead' })
    expect(mockEmail).toHaveBeenCalled()
  })

  it('never lets its own address mail itself (loop guard)', async () => {
    await receive(message(mime({}), { from: 'contact@acme.test', to: 'contact@acme.test' }))
    expect(await inboxRows()).toHaveLength(0)
  })
})

describe('platform inbound domain', () => {
  it('resolves <handle>+<mailbox>@platform to the site that owns the handle', async () => {
    globalThis.useRuntimeConfig = () => ({ ...realRuntimeConfig(), inboundEmailDomain: PLATFORM })
    await seedSetting(getCurrentTestDb(), SITE, 'email.inbound_handle', 'acme')

    await receive(message(mime({ to: `acme+contact@${PLATFORM}` }), { to: `acme+contact@${PLATFORM}` }))
    const [row] = await inboxRows()
    expect(row!.mailboxId).toBe(inboxId)
    expect(row!.toAddress).toBe(`acme+contact@${PLATFORM}`)
  })

  it('rejects an unknown handle', async () => {
    globalThis.useRuntimeConfig = () => ({ ...realRuntimeConfig(), inboundEmailDomain: PLATFORM })
    await receive(message(mime({}), { to: `nope+contact@${PLATFORM}` }))
    expect(await inboxRows()).toHaveLength(0)
  })
})

describe('email-to-draft', () => {
  const POST_LOCAL = 'post-testaddresstestaddress1'
  const PASS = 'mx.cloudflare.net; dkim=pass header.d=example.org; spf=pass; dmarc=pass'

  beforeAll(async () => {
    await getCurrentTestDb().insert(mailboxes).values({ id: ulid(), siteId: SITE, localPart: POST_LOCAL, name: 'Post by email', kind: 'post', userId: authorId, notify: false })
  })

  async function drafts() {
    return getCurrentTestDb().query.contentItems.findMany({ where: and(eq(contentItems.siteId, SITE), eq(contentItems.authorId, authorId)) })
  }

  it('turns a verified email from the owner into a draft post with its images', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64')
    await receive(message(mime({
      from: 'Author <author@example.org>',
      to: `${POST_LOCAL}@acme.test`,
      subject: 'My trip to the coast',
      html: '<p>We went to the <strong>sea</strong>.</p><img src="cid:photo1"><img src="https://tracker.test/pixel.gif">',
      attachments: [
        { filename: 'beach.png', type: 'image/png', base64: png, contentId: 'photo1' },
        { filename: 'extra.png', type: 'image/png', base64: png },
      ],
    }), { from: 'author@example.org', to: `${POST_LOCAL}@acme.test`, auth: PASS }))

    const [draft] = await drafts()
    expect(draft).toMatchObject({ title: 'My trip to the coast', slug: 'my-trip-to-the-coast', status: 'draft' })
    const doc = JSON.stringify(draft!.content)
    expect(doc).toContain('sea')
    // Inline cid image swapped for the uploaded URL, trailing attachment appended,
    // remote tracking pixel dropped.
    const images = [...doc.matchAll(/https:\/\/cdn\.test\/[^"]+/g)].map(m => m[0])
    expect(images).toHaveLength(2)
    expect(doc).not.toContain('tracker.test')

    const uploaded = await getCurrentTestDb().query.media.findMany({ where: eq(media.uploadedBy, authorId) })
    expect(uploaded).toHaveLength(2)

    // The author is told, and the message is recorded against the draft (not in the inbox).
    const [record] = await inboxRows()
    expect(record!.contentItemId).toBe(draft!.id)
    expect(mockEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ subject: 'Draft created: My trip to the coast' }))

    await getCurrentTestDb().delete(contentItems).where(eq(contentItems.authorId, authorId))
  })

  it('refuses mail from anyone but the owner', async () => {
    await receive(message(mime({ from: 'mallory@evil.test', to: `${POST_LOCAL}@acme.test` }), { from: 'mallory@evil.test', to: `${POST_LOCAL}@acme.test`, auth: PASS }))
    expect(await drafts()).toHaveLength(0)
    const [note] = await getCurrentTestDb().query.notifications.findMany({ where: eq(notifications.userId, authorId) })
    expect(note!.title).toMatch(/not accepted/)
    // In-app only — a stranger can't make us email the owner.
    expect(mockEmail).not.toHaveBeenCalled()
  })

  it('refuses a forged From that claims to be the owner without DKIM/DMARC', async () => {
    await receive(message(mime({ from: 'author@example.org', to: `${POST_LOCAL}@acme.test` }), { from: 'author@example.org', to: `${POST_LOCAL}@acme.test`, auth: 'mx; spf=pass; dkim=fail; dmarc=fail' }))
    expect(await drafts()).toHaveLength(0)
  })

  it('refuses when the owner no longer has author access', async () => {
    const db = getCurrentTestDb()
    const exId = await seedUser(db, { email: 'ex@example.org' })
    await seedRole(db, exId, SITE, 'member')
    const local = 'post-formerauthorformerauthor1'
    await db.insert(mailboxes).values({ id: ulid(), siteId: SITE, localPart: local, name: 'Post by email', kind: 'post', userId: exId })
    await receive(message(mime({ from: 'ex@example.org', to: `${local}@acme.test` }), { from: 'ex@example.org', to: `${local}@acme.test`, auth: PASS }))
    const made = await db.query.contentItems.findMany({ where: eq(contentItems.authorId, exId) })
    expect(made).toHaveLength(0)
  })

  it('is never reachable through the catch-all', async () => {
    const db = getCurrentTestDb()
    const catchAllId = ulid()
    await db.insert(mailboxes).values({ id: catchAllId, siteId: SITE, localPart: '*', name: 'All', notify: false })
    try {
      await receive(message(mime({ from: 'author@example.org', to: 'post-wrongguess@acme.test' }), { from: 'author@example.org', to: 'post-wrongguess@acme.test', auth: PASS }))
      expect(await drafts()).toHaveLength(0)
      const [row] = await inboxRows()
      expect(row!.mailboxId).toBe(catchAllId)
    }
    finally {
      await db.delete(mailboxes).where(eq(mailboxes.id, catchAllId))
    }
  })
})
