import { describe, it, expect } from 'vitest'
import { canMoveItem, datesForDrop, itemTime, monthCells, type CalendarItem } from '../../app/utils/calendar'

const LONDON = 'Europe/London'

function item(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: 'i',
    title: 'T',
    slug: 't',
    status: 'draft',
    typeId: 'x',
    type: { id: 'x', slug: 'post', name: 'Posts', icon: null },
    version: 1,
    canEdit: true,
    publishedAt: null,
    scheduledAt: null,
    eventStartAt: null,
    eventEndAt: null,
    eventAllDay: null,
    eventLocation: null,
    ...overrides,
  }
}
const eventType = { id: 'e', slug: 'event', name: 'Events', icon: null }

describe('monthCells', () => {
  it('starts the week on the chosen day and fills whole weeks', () => {
    // 1 March 2027 is a Monday.
    expect(monthCells(2027, 2, 1)[0]).toEqual({ date: '2027-03-01', day: 1 })
    const sunday = monthCells(2027, 2, 0)
    expect(sunday[0]).toEqual({ date: null, day: null })
    expect(sunday[1]).toEqual({ date: '2027-03-01', day: 1 })
    expect(sunday.length % 7).toBe(0)
  })

  it('has every day of the month, leap years included', () => {
    expect(monthCells(2028, 1, 1).filter(c => c.date)).toHaveLength(29)
  })
})

describe('canMoveItem', () => {
  it('moves plans and events, not what has already gone out', () => {
    expect(canMoveItem(item({ status: 'draft' }))).toBe(true)
    expect(canMoveItem(item({ status: 'scheduled' }))).toBe(true)
    expect(canMoveItem(item({ status: 'published' }))).toBe(false)
    expect(canMoveItem(item({ status: 'published', type: eventType }))).toBe(true)
    expect(canMoveItem(item({ status: 'draft', canEdit: false }))).toBe(false)
  })
})

describe('datesForDrop', () => {
  it('moves a scheduled post, keeping its time of day', () => {
    const scheduled = item({ status: 'scheduled', scheduledAt: '2027-07-15T17:00:00.000Z', calendarDate: '2027-07-15', calendarEndDate: '2027-07-15' })
    expect(datesForDrop(scheduled, '2027-07-20', LONDON)).toEqual({ scheduledAt: '2027-07-20T17:00:00.000Z' })
  })

  it('keeps the clock time across a clock change', () => {
    // 18:00 BST (17:00Z) to 18:00 GMT (18:00Z) after the clocks go back.
    const scheduled = item({ status: 'scheduled', scheduledAt: '2027-10-30T17:00:00.000Z', calendarDate: '2027-10-30' })
    expect(datesForDrop(scheduled, '2027-11-02', LONDON)).toEqual({ scheduledAt: '2027-11-02T18:00:00.000Z' })
  })

  it('gives an undated draft a planned date at a default time', () => {
    expect(datesForDrop(item({}), '2027-07-20', LONDON)).toEqual({ scheduledAt: '2027-07-20T08:00:00.000Z' })
  })

  it('moves a timed event with its end', () => {
    const ev = item({ type: eventType, eventStartAt: '2027-07-15T17:00:00.000Z', eventEndAt: '2027-07-16T09:00:00.000Z', calendarDate: '2027-07-15', calendarEndDate: '2027-07-16' })
    expect(datesForDrop(ev, '2027-07-22', LONDON)).toEqual({ eventStartAt: '2027-07-22T17:00:00.000Z', eventEndAt: '2027-07-23T09:00:00.000Z' })
  })

  it('moves an all-day event as dates, keeping its length', () => {
    const ev = item({ type: eventType, eventAllDay: true, eventStartAt: '2027-07-15T00:00:00.000Z', eventEndAt: '2027-07-17T00:00:00.000Z', calendarDate: '2027-07-15', calendarEndDate: '2027-07-17' })
    expect(datesForDrop(ev, '2027-08-01', LONDON)).toEqual({ eventStartAt: '2027-08-01T00:00:00.000Z', eventEndAt: '2027-08-03T00:00:00.000Z' })
  })

  it('gives an undated event its start date', () => {
    expect(datesForDrop(item({ type: eventType }), '2027-07-20', LONDON)).toEqual({ eventStartAt: '2027-07-20T08:00:00.000Z' })
  })

  it('does nothing for the same day, or for what cannot move', () => {
    expect(datesForDrop(item({ status: 'scheduled', scheduledAt: '2027-07-15T17:00:00.000Z', calendarDate: '2027-07-15' }), '2027-07-15', LONDON)).toBeNull()
    expect(datesForDrop(item({ status: 'published', publishedAt: '2027-07-15 17:00:00', calendarDate: '2027-07-15' }), '2027-07-20', LONDON)).toBeNull()
    expect(datesForDrop(item({ canEdit: false }), '2027-07-20', LONDON)).toBeNull()
  })
})

describe('itemTime', () => {
  it('is blank for all-day events and the site clock otherwise', () => {
    expect(itemTime(item({ eventAllDay: true, eventStartAt: '2027-07-15T00:00:00.000Z' }), LONDON)).toBe('')
    expect(itemTime(item({ eventStartAt: '2027-07-15T17:00:00.000Z' }), LONDON)).toBe('18:00')
    expect(itemTime(item({ status: 'published', publishedAt: '2027-07-15 17:00:00' }), LONDON)).toBe('18:00')
  })
})
