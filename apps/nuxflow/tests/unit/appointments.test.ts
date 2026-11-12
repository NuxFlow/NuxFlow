import { describe, it, expect } from 'vitest'
import { zonedToUtc } from '@nuxflow/canvas/events'
import { formatDuration, freeTimes, isDayOff, parseAppointmentSettings, parseService, weekdayOf } from '../../shared/lib/appointments'
import { hoursFor, normalizeAppointmentSetting, findAppointmentBlock, cancellationTerms } from '../../server/utils/appointments'

const service = (over: Record<string, unknown> = {}) => parseService({ duration: 60, step: 30, noticeHours: 0, ...over })
const utc = (w: string) => zonedToUtc(w, 'UTC')
const longAgo = new Date('2000-01-01T00:00:00Z')

describe('parseService', () => {
  it('reads block props with safe limits and defaults', () => {
    const s = parseService({ serviceName: '  Massage ', duration: '45', price: '35.5', currency: 'eur' }, 'Page title')
    expect(s).toMatchObject({ name: 'Massage', duration: 45, step: 30, price: 35.5, currency: 'EUR', buffer: 0, noticeHours: 12, daysAhead: 60, cancelHours: 24 })
    expect(parseService({}, 'Page title')).toMatchObject({ name: 'Page title', duration: 60, price: null, currency: 'GBP' })
    expect(parseService({ duration: 100000, price: -5, currency: 'pounds' })).toMatchObject({ duration: 480, price: null, currency: 'GBP' })
  })
})

describe('freeTimes', () => {
  it('fits whole appointments inside each range, on the step', () => {
    const times = freeTimes({ date: '2027-03-01', hours: [{ open: '09:00', close: '11:00' }, { open: '13:00', close: '14:30' }], service: service(), busy: [], now: longAgo, toUtc: utc })
    expect(times.map(t => t.time)).toEqual(['09:00', '09:30', '10:00', '13:00', '13:30'])
    expect(times[0]).toMatchObject({ start: '2027-03-01T09:00:00.000Z', end: '2027-03-01T10:00:00.000Z' })
  })

  it('leaves out anything overlapping a booking, counting the new one\'s gap after it', () => {
    const busy = [{ start: '2027-03-01T10:00:00.000Z', end: '2027-03-01T11:00:00.000Z' }]
    const times = freeTimes({ date: '2027-03-01', hours: [{ open: '09:00', close: '12:00' }], service: service({ buffer: 30 }), busy, now: longAgo, toUtc: utc })
    // 09:00 + 60 min + 30 min gap reaches 10:30, so it clashes; 11:00 is the first free.
    expect(times.map(t => t.time)).toEqual(['11:00'])
  })

  it('respects the notice needed', () => {
    const now = new Date('2027-03-01T08:30:00Z')
    const times = freeTimes({ date: '2027-03-01', hours: [{ open: '09:00', close: '12:00' }], service: service({ noticeHours: 2 }), busy: [], now, toUtc: utc })
    expect(times[0]!.time).toBe('10:30')
  })

  it('works in the site\'s time zone, across a clock change', () => {
    // Clocks go forward in London on 28 March 2027: 09:00 is then 08:00 UTC.
    const times = freeTimes({ date: '2027-03-29', hours: [{ open: '09:00', close: '10:00' }], service: service(), busy: [], now: longAgo, toUtc: w => zonedToUtc(w, 'Europe/London') })
    expect(times.map(t => t.start)).toEqual(['2027-03-29T08:00:00.000Z'])
  })

  it('treats a closing time at or before the opening as midnight', () => {
    const times = freeTimes({ date: '2027-03-01', hours: [{ open: '22:00', close: '00:00' }], service: service({ step: 60 }), busy: [], now: longAgo, toUtc: utc })
    expect(times.map(t => t.time)).toEqual(['22:00', '23:00'])
  })
})

describe('appointment settings', () => {
  it('reads leniently and keeps days off in order', () => {
    const s = parseAppointmentSettings({ useOpeningHours: false, hours: { mon: [{ open: '09:00', close: '17:00' }, { open: 'nine', close: '5' }] }, daysOff: [{ from: '2027-01-05', to: '2027-01-02' }, { from: 'x' }] })
    expect(s.useOpeningHours).toBe(false)
    expect(s.hours.mon).toEqual([{ open: '09:00', close: '17:00' }])
    expect(s.hours.tue).toEqual([])
    expect(s.daysOff).toEqual([{ from: '2027-01-05', to: '2027-01-05' }])
    expect(parseAppointmentSettings(null).useOpeningHours).toBe(true)
  })

  it('refuses a save with times or dates it can\'t read', () => {
    expect(() => normalizeAppointmentSetting({ useOpeningHours: false, hours: { mon: [{ open: '9am', close: '5pm' }] }, daysOff: [] })).toThrow()
    expect(() => normalizeAppointmentSetting({ useOpeningHours: true, hours: {}, daysOff: [{ from: 'soon', to: 'later' }] })).toThrow()
    expect(normalizeAppointmentSetting({ useOpeningHours: true, hours: {}, daysOff: [] }).useOpeningHours).toBe(true)
  })

  it('works out a date\'s hours from own hours, opening hours and days off', () => {
    const own = parseAppointmentSettings({ useOpeningHours: false, hours: { mon: [{ open: '10:00', close: '12:00' }] }, daysOff: [{ from: '2027-03-08', to: '2027-03-08' }] })
    expect(weekdayOf('2027-03-01')).toBe('mon')
    expect(hoursFor(own, null, '2027-03-01')).toEqual([{ open: '10:00', close: '12:00' }])
    expect(isDayOff(own, '2027-03-08')).toBe(true)
    expect(hoursFor(own, null, '2027-03-08')).toEqual([])

    const business = { kind: 'LocalBusiness', hours: { mon: [{ open: '08:00', close: '18:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, exceptions: [{ date: '2027-03-15', slots: [] }] }
    const opening = parseAppointmentSettings({ useOpeningHours: true })
    expect(hoursFor(opening, business, '2027-03-01')).toEqual([{ open: '08:00', close: '18:00' }])
    expect(hoursFor(opening, business, '2027-03-15')).toEqual([])
    expect(hoursFor(opening, null, '2027-03-01')).toEqual([])
  })
})

describe('helpers', () => {
  it('finds an appointment block by id, inside columns too', () => {
    const content = { blocks: [{ id: 'c', type: 'canvas-columns', children: { col1: [{ id: 'ap', type: 'canvas-appointment', props: { duration: 30 } }] } }] }
    expect(findAppointmentBlock(content, 'ap')?.props).toEqual({ duration: 30 })
    expect(findAppointmentBlock(content, 'c')).toBeNull()
  })

  it('refunds a visitor\'s cancel only before the deadline', () => {
    const now = new Date('2027-03-01T09:00:00Z')
    expect(cancellationTerms({ paymentStatus: 'paid', startsAt: '2027-03-03T09:00:00Z', cancelHours: 24 }, now)).toEqual({ refund: true, tooLate: false })
    expect(cancellationTerms({ paymentStatus: 'paid', startsAt: '2027-03-01T20:00:00Z', cancelHours: 24 }, now)).toEqual({ refund: false, tooLate: true })
    expect(cancellationTerms({ paymentStatus: null, startsAt: '2027-03-03T09:00:00Z', cancelHours: 24 }, now)).toEqual({ refund: false, tooLate: false })
  })

  it('says how long an appointment is', () => {
    expect(formatDuration(60)).toBe('1 hour')
    expect(formatDuration(90)).toBe('1 hour 30 minutes')
    expect(formatDuration(45)).toBe('45 minutes')
  })
})
