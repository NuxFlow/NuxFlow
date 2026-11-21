/**
 * Integration tests for the MCP bookings, appointments, orders, inbox, comments, stock and
 * analytics tools (server/utils/mcp-business-tools.ts), through the real JSON-RPC handler.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { appointments, auditLogs, comments, emailMessages, eventRsvps, mailboxes, orderLines, orders, productVariants, products } from '@nuxflow/db/schema'
import mcpHandler from '../../server/api/v1/mcp'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const SITE = 'site-mcp-business'
const OTHER_SITE = 'site-mcp-business-other'
let adminId: string
let editorId: string
let authorId: string
let eventTypeId: string
let pageTypeId: string

type HandlerFn = (e: H3Event) => Promise<unknown>
type ToolResult = { content: { text: string }[]; isError?: boolean }

const ALL_SCOPES = ['read:content', 'write:content', 'read:personal']

function call(name: string, args: unknown, o: { role?: string; scopes?: string[]; user?: string } = {}) {
  const event = createMockEvent({
    method: 'POST',
    siteId: SITE,
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    apiKeyUserId: o.user ?? editorId,
    apiKeyRole: o.role ?? 'editor',
    apiKeyScopes: o.scopes ?? ALL_SCOPES,
  }) as unknown as H3Event
  return (mcpHandler as HandlerFn)(event).then(r => (r as { result: ToolResult }).result)
}
const text = (r: ToolResult) => r.content[0]!.text
const json = async <T>(p: Promise<ToolResult>) => JSON.parse(text(await p)) as T

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'mcp-business.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'mcp-business-other.localhost' })
  adminId = await seedUser(db, { email: 'mcp-biz-admin@test.com' })
  editorId = await seedUser(db, { email: 'mcp-biz-editor@test.com' })
  authorId = await seedUser(db, { email: 'mcp-biz-author@test.com' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  eventTypeId = await seedContentType(db, SITE, { slug: 'event', name: 'Events', singularName: 'Event' })
  pageTypeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
})

afterAll(teardownTestDb)

describe('personal data needs read:personal', () => {
  it.each(['list_event_bookings', 'list_appointments', 'list_orders', 'get_order', 'list_inbox', 'get_inbox_thread', 'list_forms'])('%s is refused with only read:content', async (tool) => {
    const res = await call(tool, { event: 'x', id: 'x' }, { role: 'admin', user: adminId, scopes: ['read:content', 'write:content'] })
    expect(res.isError).toBe(true)
    expect(text(res)).toMatch(/read:personal/)
  })
})

describe('MCP event bookings', () => {
  it('lists an event\'s bookings by slug with totals and no payment ids', async () => {
    const db = getCurrentTestDb()
    const id = await seedContentItem(db, SITE, eventTypeId, { slug: 'quiz-night', title: 'Quiz night', eventStartAt: '2027-03-01T19:00:00.000Z', eventRsvpEnabled: true, eventRsvpCapacity: 20 })
    await db.insert(eventRsvps).values([
      { id: ulid(), siteId: SITE, contentItemId: id, email: 'ada@example.com', name: 'Ada', seats: 2, status: 'confirmed', paymentMethod: 'card', paymentStatus: 'paid', amountPaid: 20, currency: 'GBP', stripeSessionId: 'cs_secret', stripePaymentIntentId: 'pi_secret' },
      { id: ulid(), siteId: SITE, contentItemId: id, email: 'bob@example.com', name: 'Bob', status: 'waitlist' },
      { id: ulid(), siteId: SITE, contentItemId: id, email: 'cy@example.com', name: 'Cy', status: 'cancelled' },
    ])
    const raw = text(await call('list_event_bookings', { event: 'quiz-night' }))
    expect(raw).not.toContain('cs_secret')
    expect(raw).not.toContain('pi_secret')
    const out = JSON.parse(raw) as { event: { title: string; capacity: number }; counts: Record<string, number>; bookings: { name: string; seats: number }[] }
    expect(out.event).toMatchObject({ title: 'Quiz night', capacity: 20 })
    expect(out.bookings.map(b => b.name)).toEqual(['Ada', 'Bob'])
    expect(out.counts.confirmed).toBe(2)

    const all = await json<{ bookings: unknown[] }>(call('list_event_bookings', { event: id, status: 'all' }))
    expect(all.bookings).toHaveLength(3)
  })

  it('needs editor', async () => {
    expect(text(await call('list_event_bookings', { event: 'quiz-night' }, { role: 'author', user: authorId }))).toMatch(/needs editor/)
  })
})

describe('MCP appointments', () => {
  it('lists upcoming appointments for this site only', async () => {
    const db = getCurrentTestDb()
    const start = new Date(Date.now() + 86_400_000)
    const end = new Date(start.getTime() + 3_600_000)
    const base = { contentItemId: 'x', blockId: 'b', serviceName: 'Haircut', startsAt: start.toISOString(), endsAt: end.toISOString(), blockedUntil: end.toISOString(), status: 'confirmed' as const }
    await db.insert(appointments).values([
      { id: ulid(), siteId: SITE, email: 'dee@example.com', name: 'Dee', ...base },
      { id: ulid(), siteId: OTHER_SITE, email: 'eve@example.com', name: 'Eve', ...base },
    ])
    const out = await json<{ appointments: { name: string; service: string }[] }>(call('list_appointments', {}))
    expect(out.appointments.map(a => a.name)).toEqual(['Dee'])
    expect(out.appointments[0]!.service).toBe('Haircut')
  })
})

describe('MCP orders', () => {
  let orderId: string
  beforeAll(async () => {
    const db = getCurrentTestDb()
    orderId = ulid()
    await db.insert(orders).values({ id: orderId, siteId: SITE, number: 1001, status: 'paid', email: 'fay@example.com', name: 'Fay', currency: 'GBP', subtotalMinor: 2500, shippingMinor: 350, totalMinor: 2850, paidAt: new Date().toISOString() })
    await db.insert(orderLines).values({ id: ulid(), orderId, siteId: SITE, kind: 'product', name: 'Mug', quantity: 2, unitMinor: 1250, totalMinor: 2500 })
    await db.insert(orders).values({ id: ulid(), siteId: OTHER_SITE, number: 1001, status: 'paid', email: 'other@example.com', name: 'Other', currency: 'GBP', totalMinor: 100 })
  })

  it('lists sales with formatted totals and lines; admins only', async () => {
    const out = await json<{ total: number; orders: { number: number; total: string; lines: { name: string }[] }[] }>(call('list_orders', {}, { role: 'admin', user: adminId }))
    expect(out.total).toBe(1)
    expect(out.orders[0]).toMatchObject({ number: 1001, total: '£28.50', lines: [{ name: 'Mug', quantity: 2 }] })
    expect(text(await call('list_orders', {}))).toMatch(/needs admin/)
  })

  it('reads one order, and never another site\'s', async () => {
    const out = await json<{ shipping: string; lines: { unitPrice: string }[] }>(call('get_order', { id: orderId }, { role: 'admin', user: adminId }))
    expect(out).toMatchObject({ shipping: '£3.50', lines: [{ unitPrice: '£12.50', total: '£25.00' }] })
    const db = getCurrentTestDb()
    const foreign = await db.query.orders.findFirst({ where: eq(orders.siteId, OTHER_SITE) })
    const res = await call('get_order', { id: foreign!.id }, { role: 'admin', user: adminId })
    expect(res.isError).toBe(true)
  })
})

describe('MCP inbox', () => {
  let threadMessageId: string
  beforeAll(async () => {
    const db = getCurrentTestDb()
    const inbox = ulid()
    const post = ulid()
    await db.insert(mailboxes).values([
      { id: inbox, siteId: SITE, localPart: 'hello', name: 'Hello', kind: 'inbox' },
      { id: post, siteId: SITE, localPart: 'post-abc', name: 'Post', kind: 'post' },
    ])
    threadMessageId = ulid()
    await db.insert(emailMessages).values([
      { id: threadMessageId, siteId: SITE, mailboxId: inbox, threadId: 't1', direction: 'inbound', fromAddress: 'gil@example.com', fromName: 'Gil', toAddress: 'hello@site', subject: 'Opening times?', htmlBody: '<p>Are you open <b>Sunday</b>?</p><script>x</script>', status: 'new', category: 'lead' },
      { id: ulid(), siteId: SITE, mailboxId: post, threadId: 't2', direction: 'inbound', fromAddress: 'me@example.com', toAddress: 'post-abc@site', subject: 'My draft post', status: 'new' },
    ])
  })

  it('lists inbox messages, leaving post-by-email out', async () => {
    const rows = await json<{ subject: string }[]>(call('list_inbox', {}))
    expect(rows.map(r => r.subject)).toEqual(['Opening times?'])
  })

  it('reads a thread as plain text without marking it read', async () => {
    const thread = await json<{ body: string }[]>(call('get_inbox_thread', { id: threadMessageId }))
    expect(thread[0]!.body).toMatch(/Are you open\s+Sunday/)
    expect(thread[0]!.body).not.toContain('<')
    const row = await getCurrentTestDb().query.emailMessages.findFirst({ where: eq(emailMessages.id, threadMessageId) })
    expect(row!.status).toBe('new')
  })
})

describe('MCP comments', () => {
  it('lists pending comments without email addresses, and moderates them', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, pageTypeId, { slug: 'commented', title: 'Commented page' })
    const id = ulid()
    await db.insert(comments).values({ id, siteId: SITE, itemId, body: 'Great post!', guestName: 'Hal', guestEmail: 'hal@example.com', status: 'pending' })
    const raw = text(await call('list_comments', {}))
    expect(raw).not.toContain('hal@example.com')
    expect(JSON.parse(raw)).toEqual([expect.objectContaining({ id, author: 'Hal', page: 'Commented page' })])

    expect(text(await call('moderate_comment', { id, status: 'approved' }))).toContain('approved')
    expect((await db.query.comments.findFirst({ where: eq(comments.id, id) }))!.status).toBe('approved')
    expect(await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.resource, 'comment'), eq(auditLogs.resourceId, id)) })).toBeTruthy()
    expect(text(await call('moderate_comment', { id, status: 'spam' }, { role: 'author', user: authorId }))).toMatch(/needs editor/)
  })
})

describe('MCP products and stock', () => {
  let tracked: string
  beforeAll(async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, pageTypeId, { slug: 'mug', title: 'Mug' })
    await db.insert(products).values({ contentItemId: itemId, siteId: SITE, optionNames: ['Colour'] })
    tracked = ulid()
    await db.insert(productVariants).values([
      { id: tracked, siteId: SITE, contentItemId: itemId, sku: 'MUG-BLU', options: ['Blue'], priceMinor: 1250, stock: 3 },
      { id: ulid(), siteId: SITE, contentItemId: itemId, sku: 'MUG-RED', options: ['Red'], priceMinor: 1250, stock: null },
      { id: ulid(), siteId: SITE, contentItemId: itemId, sku: 'MUG-PDF', options: ['Guide'], priceMinor: 500, kind: 'digital' },
    ])
  })

  it('lists products with variants, and filters low stock', async () => {
    const out = await json<{ products: { title: string; variants: { sku: string; stock: number | null; name: string }[] }[] }>(call('list_products', { lowStock: 5 }))
    expect(out.products.map(p => p.title)).toEqual(['Mug'])
    expect(out.products[0]!.variants.find(v => v.sku === 'MUG-BLU')).toMatchObject({ stock: 3, name: 'Blue' })
    const none = await json<{ products: unknown[] }>(call('list_products', { lowStock: 2 }))
    expect(none.products).toHaveLength(0)
  })

  it('changes stock by SKU without going below 0, and sets it by id', async () => {
    const db = getCurrentTestDb()
    expect(text(await call('set_stock', { variant: 'MUG-BLU', change: 5 }))).toContain('now 8')
    expect(text(await call('set_stock', { variant: 'MUG-BLU', change: -20 }))).toContain('now 0')
    expect(text(await call('set_stock', { variant: tracked, set: 12 }))).toContain('now 12')
    expect((await db.query.productVariants.findFirst({ where: eq(productVariants.id, tracked) }))!.stock).toBe(12)
    expect(await db.query.auditLogs.findFirst({ where: and(eq(auditLogs.resource, 'product_variant'), eq(auditLogs.resourceId, tracked)) })).toBeTruthy()
  })

  it('refuses untracked changes, digital products and authors', async () => {
    expect(text(await call('set_stock', { variant: 'MUG-RED', change: 1 }))).toMatch(/isn't tracked/)
    expect(text(await call('set_stock', { variant: 'MUG-PDF', set: 1 }))).toMatch(/Digital/)
    expect(text(await call('set_stock', { variant: 'MUG-BLU', set: 1 }, { role: 'author', user: authorId }))).toMatch(/needs editor/)
    expect(text(await call('set_stock', { variant: 'MUG-BLU', set: 1, change: 1 }))).toMatch(/either set or change/)
  })
})

describe('MCP analytics', () => {
  it('explains when analytics aren\'t set up', async () => {
    expect(text(await call('get_analytics', {}))).toMatch(/aren't switched on/)
    expect(text(await call('get_analytics', { days: 12 }))).toMatch(/days must be one of/)
  })
})
