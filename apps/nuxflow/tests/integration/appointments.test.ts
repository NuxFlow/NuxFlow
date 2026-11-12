/**
 * One-to-one appointments through the routes: free times from the hours, booking with an
 * emailed confirm link, no overlaps (gap after each included), card payments through the
 * webhook, refunds on cancelling, the team's list and the day-before reminders. Stripe and
 * the email provider are the only things not real here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import type * as SettingsModule from '../../server/utils/settings'
import { and, eq } from 'drizzle-orm'
import { addDays } from '@nuxflow/canvas/events'
import { appointments } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedContentItem, seedContentType, seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))

const { mockSend, stripe } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ messageId: 'm-1' }),
  stripe: {
    createPaymentCheckout: vi.fn(),
    getCheckoutSession: vi.fn(),
    expireCheckoutSession: vi.fn(),
    refundPayment: vi.fn(),
  },
}))
vi.mock('../../server/utils/email', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmailWithConfig: mockSend,
}))
vi.mock('../../server/utils/payments/stripe', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  StripeProvider: vi.fn().mockImplementation(function () { return stripe }),
}))
vi.mock('../../server/utils/settings', async (importOriginal) => {
  const original = await importOriginal<typeof SettingsModule>()
  return {
    ...original,
    resolveStringSetting: async (event: H3Event, key: string, envKey?: string) => {
      if (key === 'payments.stripe_secret_key' || key === 'payments.stripe_webhook_secret') return 'configured'
      return original.resolveStringSetting(event, key, envKey)
    },
  }
})

const { default: getRoute } = await import('../../server/routes/_nuxflow/appointments.get')
const { default: postRoute } = await import('../../server/routes/_nuxflow/appointments.post')
const { default: icsRoute } = await import('../../server/routes/_nuxflow/appointment-ics/[id]')
const { appointmentToken } = await import('../../server/utils/appointments')
const { handleOneOffCheckoutCompleted } = await import('../../server/utils/booking-webhooks')
const { sendAppointmentReminders } = await import('../../server/scheduled/appointment-reminders')

type Handler = (e: H3Event) => Promise<unknown>
type Row = typeof appointments.$inferSelect
interface Free { days: Array<{ date: string; times: Array<{ start: string; time: string }> }>; service: { price: number | null } }

const SITE = 'site-appt-01'
const db = () => getCurrentTestDb()
const today = new Date().toISOString().slice(0, 10)
const at = (days: number, time: string) => `${addDays(today, days)}T${time}:00.000Z`
let editorId: string
let seq = 0

function ev(opts: { userId?: string; body?: unknown; query?: Record<string, string>; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: opts.userId ? { user: { id: opts.userId, name: 'U', email: 'staff@appt.test' } } : undefined,
    body: opts.body,
    query: opts.query,
    params: opts.params,
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: { 'host': 'appt.localhost', 'sec-fetch-site': 'same-origin' },
  }) as unknown as H3Event
}

const free = (block: string, from?: string) => (getRoute as Handler)(ev({ query: { path: 'massage', block, ...(from ? { from } : {}) } })) as Promise<Free>
const timesOn = async (block: string, days: number) => (await free(block)).days.find(d => d.date === addDays(today, days))?.times.map(t => t.time) ?? []
const book = (block: string, start: string, address = `v${++seq}@visitors.test`) =>
  (postRoute as Handler)(ev({ body: { action: 'book', path: 'massage', block, start, name: 'Vic', email: address } })) as Promise<{ status: string; id: string; url?: string }>
const rowOf = async (id: string) => (await db().query.appointments.findFirst({ where: eq(appointments.id, id) })) as Row
const linkPost = async (action: 'confirm' | 'cancel', id: string) =>
  (postRoute as Handler)(ev({ body: { action, id, token: await appointmentToken(action, SITE, id) } })) as Promise<{ status: string; refund?: boolean }>
const subjects = () => mockSend.mock.calls.map(c => (c[1] as { subject?: string }).subject)

beforeAll(async () => {
  await initTestDb()
  await seedSite(db(), { id: SITE, domain: 'appt.localhost', timezone: 'UTC' })
  editorId = await seedUser(db(), { email: 'editor@appt.test' })
  await seedRole(db(), editorId, SITE, 'editor')
  await seedSetting(db(), SITE, 'email.provider', 'resend')
  await seedSetting(db(), SITE, 'email.resend_api_key', 're_test_key')
  const every = [{ open: '09:00', close: '17:00' }]
  await seedSetting(db(), SITE, 'appointments.settings', {
    useOpeningHours: false,
    hours: { mon: every, tue: every, wed: every, thu: every, fri: every, sat: every, sun: every },
    daysOff: [{ from: addDays(today, 20), to: addDays(today, 21) }],
  })
  const type = await seedContentType(db(), SITE, { slug: 'page', name: 'Page' })
  const base = { duration: 60, step: 60, noticeHours: 0, daysAhead: 30 }
  await seedContentItem(db(), SITE, type, {
    slug: 'massage',
    title: 'Massage',
    content: {
      type: 'canvas',
      blocks: [
        { id: 'free', type: 'canvas-appointment', props: { ...base, serviceName: 'Chat', buffer: 30 } },
        { id: 'paid', type: 'canvas-appointment', props: { ...base, serviceName: 'Massage', price: 50, currency: 'GBP', cancelHours: 24 } },
      ],
    },
  })
})
afterAll(teardownTestDb)

beforeEach(() => {
  mockSend.mockClear()
  for (const fn of Object.values(stripe)) fn.mockReset()
  stripe.createPaymentCheckout.mockImplementation(async () => ({ id: `cs_${++seq}`, url: `https://checkout.stripe.test/${seq}` }))
  stripe.refundPayment.mockResolvedValue({ id: 're_1' })
})

describe('appointments', () => {
  it('offers whole appointments inside the hours, and nothing on days off', async () => {
    expect(await timesOn('free', 3)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'])
    const later = await free('free', addDays(today, 15))
    expect(later.days.find(d => d.date === addDays(today, 20))?.times).toEqual([])
    expect(later.service.price).toBeNull()
  })

  it('keeps a free time while the visitor confirms by email, then books it', async () => {
    const answer = await book('free', at(3, '09:00'))
    expect(answer.status).toBe('pending')
    expect(subjects()).toContain('Confirm your appointment: Chat')
    // Kept: 09:00 is gone, and so is 10:00, inside the 30-minute gap after it.
    expect(await timesOn('free', 3)).toEqual(['11:00', '12:00', '13:00', '14:00', '15:00', '16:00'])

    const confirmed = await linkPost('confirm', answer.id)
    expect(confirmed.status).toBe('confirmed')
    expect((await rowOf(answer.id)).status).toBe('confirmed')
    expect(subjects()).toContain('Booked: Chat')
  })

  it('never lets two people have overlapping times', async () => {
    await expect(book('free', at(3, '09:00'))).rejects.toMatchObject({ statusCode: 409 })
    // The paid service has no gap of its own, but the free one's gap after 09:00 still counts.
    await expect(book('paid', at(3, '10:00'))).rejects.toMatchObject({ statusCode: 409 })
    // A time that isn't on the grid can't be sent.
    await expect(book('free', at(3, '11:30'))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('gives an "add to calendar" file behind a signed link', async () => {
    const [row] = await db().select().from(appointments).where(and(eq(appointments.siteId, SITE), eq(appointments.status, 'confirmed')))
    const ics = await (icsRoute as Handler)(ev({ params: { id: row!.id }, query: { token: await appointmentToken('ics', SITE, row!.id) } })) as string
    expect(ics).toContain('SUMMARY:Chat')
    await expect((icsRoute as Handler)(ev({ params: { id: row!.id }, query: { token: 'f'.repeat(64) } }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('frees the time when the visitor cancels', async () => {
    const answer = await book('free', at(4, '14:00'))
    await linkPost('confirm', answer.id)
    expect(await timesOn('free', 4)).not.toContain('14:00')
    expect((await linkPost('cancel', answer.id)).status).toBe('cancelled')
    expect(await timesOn('free', 4)).toContain('14:00')
  })

  it('takes card payments: held at Stripe, booked by the webhook, refunded on an in-time cancel', async () => {
    const answer = await book('paid', at(6, '11:00'))
    expect(answer).toMatchObject({ status: 'checkout', url: expect.stringContaining('checkout.stripe.test') })
    const held = await rowOf(answer.id)
    expect(held.status).toBe('held')
    const args = stripe.createPaymentCheckout.mock.calls[0]![0] as { item: { amount: number }; metadata: Record<string, string> }
    expect(args.item.amount).toBe(50)

    await handleOneOffCheckoutCompleted(ev(), {
      id: held.stripeSessionId!, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_appt_1', amount_total: 5000, currency: 'gbp', metadata: args.metadata,
    })
    const booked = await rowOf(answer.id)
    expect(booked).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', stripePaymentIntentId: 'pi_appt_1' })
    expect(subjects()).toContain('Booked: Massage')

    const cancelled = await linkPost('cancel', answer.id)
    expect(cancelled).toMatchObject({ status: 'cancelled', refund: true })
    expect(stripe.refundPayment).toHaveBeenCalled()
    expect((await rowOf(answer.id)).paymentStatus).toBe('refunded')
  })

  it('refunds a payment that lands after the time went to someone else', async () => {
    const answer = await book('paid', at(7, '15:00'))
    const held = await rowOf(answer.id)
    const args = stripe.createPaymentCheckout.mock.calls[0]![0] as { metadata: Record<string, string> }
    // Their checkout ran out and someone else booked the time.
    await db().update(appointments).set({ holdExpiresAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(appointments.id, answer.id))
    const other = await book('free', at(7, '15:00'))
    await linkPost('confirm', other.id)

    await handleOneOffCheckoutCompleted(ev(), {
      id: held.stripeSessionId!, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_appt_late', amount_total: 5000, currency: 'gbp', metadata: args.metadata,
    })
    expect(await rowOf(answer.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' })
    expect(stripe.refundPayment).toHaveBeenCalled()
    expect(subjects()).toContain('We\'ve refunded you: Massage')
  })

  it('lists appointments for the team, who can cancel them', async () => {
    await expect((getRoute as Handler)(ev({ query: { team: 'upcoming' } }))).rejects.toMatchObject({ statusCode: 401 })
    const list = await (getRoute as Handler)(ev({ userId: editorId, query: { team: 'upcoming' } })) as { appointments: Array<{ id: string; status: string; service: string }> }
    const live = list.appointments.filter(a => a.status === 'confirmed')
    expect(live.length).toBeGreaterThan(0)
    const res = await (postRoute as Handler)(ev({ userId: editorId, body: { action: 'team-cancel', id: live[0]!.id } })) as { refunded: boolean }
    expect(res.refunded).toBe(false)
    expect((await rowOf(live[0]!.id)).status).toBe('cancelled')
    expect(subjects()).toContain('Cancelled: Chat')
  })

  it('sends one reminder the day before', async () => {
    const id = `appt-${++seq}`
    const start = new Date(Date.now() + 5 * 3_600_000)
    await db().insert(appointments).values({
      id, siteId: SITE, contentItemId: 'x', blockId: 'free', serviceName: 'Chat', email: 'soon@visitors.test', name: 'Soon',
      startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), blockedUntil: new Date(start.getTime() + 3_600_000).toISOString(),
      status: 'confirmed',
    })
    expect(await sendAppointmentReminders()).toEqual({ reminded: 1 })
    expect(await sendAppointmentReminders()).toEqual({ reminded: 0 })
    expect(subjects()).toContain('Reminder: Chat')
  })
})
