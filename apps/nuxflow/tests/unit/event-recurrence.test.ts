import { describe, it, expect } from 'vitest'
import { describeRecurrence, occurrenceOn, occurrencesBetween, upcomingOccurrences, type EventRecurrence } from '../../../../packages/canvas/src/utils/event-dates'

// Tuesday 6 Jan 2026, 18:00–19:00 in London (GMT in January).
const yoga = { eventStartAt: '2026-01-06T18:00:00.000Z', eventEndAt: '2026-01-06T19:00:00.000Z' }
const weekly = (over: Partial<EventRecurrence> = {}): EventRecurrence => ({ freq: 'weekly', interval: 1, weekdays: [2], ...over })
const days = (list: Array<{ date: string }>) => list.map(d => d.date)

describe('occurrencesBetween', () => {
  it('lists a weekly class on its weekday', () => {
    expect(days(occurrencesBetween(yoga, weekly(), 'Europe/London', '2026-01-01', '2026-01-31')))
      .toEqual(['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'])
  })

  it('handles several weekdays and starts no earlier than the first date', () => {
    expect(days(occurrencesBetween(yoga, weekly({ weekdays: [2, 4] }), 'Europe/London', '2026-01-01', '2026-01-15')))
      .toEqual(['2026-01-06', '2026-01-08', '2026-01-13', '2026-01-15'])
  })

  it('keeps both days of a fortnightly rule in the same fortnight', () => {
    expect(days(occurrencesBetween(yoga, weekly({ interval: 2, weekdays: [2, 4] }), 'Europe/London', '2026-01-06', '2026-01-31')))
      .toEqual(['2026-01-06', '2026-01-08', '2026-01-20', '2026-01-22'])
  })

  it('counts weeks from the week of the first date, even when that weekday comes later', () => {
    // Starts on a Thursday; "every 2 weeks on Tue" still means that first fortnight's week.
    const thursday = { eventStartAt: '2026-01-08T18:00:00.000Z' }
    expect(days(occurrencesBetween(thursday, weekly({ interval: 2 }), 'UTC', '2026-01-01', '2026-02-10')))
      .toEqual(['2026-01-20', '2026-02-03'])
  })

  it('respects the last date and skipped dates', () => {
    expect(days(occurrencesBetween(yoga, weekly({ until: '2026-01-20', skip: ['2026-01-13'] }), 'UTC', '2026-01-01', '2026-12-31')))
      .toEqual(['2026-01-06', '2026-01-20'])
  })

  it('misses a month with no such date instead of moving it', () => {
    const on31st = { eventStartAt: '2026-01-31T09:00:00.000Z' }
    expect(days(occurrencesBetween(on31st, { freq: 'monthly', interval: 1 }, 'UTC', '2026-01-01', '2026-05-31')))
      .toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })

  it('handles every-few-days rules', () => {
    expect(days(occurrencesBetween(yoga, { freq: 'daily', interval: 3 }, 'UTC', '2026-01-06', '2026-01-15')))
      .toEqual(['2026-01-06', '2026-01-09', '2026-01-12', '2026-01-15'])
  })

  it('stops at the cap', () => {
    expect(occurrencesBetween(yoga, { freq: 'daily', interval: 1 }, 'UTC', '2026-01-06', '2030-01-01', 5)).toHaveLength(5)
  })
})

describe('occurrenceOn', () => {
  it('keeps the wall clock across a clock change', () => {
    // UK clocks go forward on 29 March 2026: 18:00 in London is 17:00 UTC from then on.
    const after = occurrenceOn(yoga, weekly(), '2026-03-31', 'Europe/London')
    expect(after).toEqual({ date: '2026-03-31', startAt: '2026-03-31T17:00:00.000Z', endAt: '2026-03-31T18:00:00.000Z' })
  })

  it('refuses a day the rule does not include', () => {
    expect(occurrenceOn(yoga, weekly(), '2026-01-07', 'UTC')).toBeNull()
    expect(occurrenceOn(yoga, weekly(), '2025-12-30', 'UTC')).toBeNull()
  })

  it('moves an all-day series by whole dates', () => {
    const retreat = { eventStartAt: '2026-01-06T00:00:00.000Z', eventEndAt: '2026-01-07T00:00:00.000Z', eventAllDay: true }
    expect(occurrenceOn(retreat, weekly(), '2026-01-13', 'America/New_York'))
      .toEqual({ date: '2026-01-13', startAt: '2026-01-13T00:00:00.000Z', endAt: '2026-01-14T00:00:00.000Z' })
  })
})

describe('upcomingOccurrences', () => {
  it('starts at the next date that has not finished', () => {
    const during = new Date('2026-01-13T18:30:00.000Z')
    expect(days(upcomingOccurrences(yoga, weekly(), 'UTC', 2, during))).toEqual(['2026-01-13', '2026-01-20'])
    const after = new Date('2026-01-13T19:30:00.000Z')
    expect(days(upcomingOccurrences(yoga, weekly(), 'UTC', 2, after))).toEqual(['2026-01-20', '2026-01-27'])
  })

  it('finds nothing once a series is over', () => {
    expect(upcomingOccurrences(yoga, weekly({ until: '2026-01-13' }), 'UTC', 2, new Date('2026-06-01T00:00:00.000Z'))).toEqual([])
  })
})

describe('describeRecurrence', () => {
  it('reads as words, Monday first', () => {
    expect(describeRecurrence(weekly({ weekdays: [0, 2] }), 'en-GB')).toBe('Every week on Tue, Sun')
    expect(describeRecurrence({ freq: 'monthly', interval: 2 })).toBe('Every 2 months')
    expect(describeRecurrence({ freq: 'daily', interval: 1, until: '2026-03-01' }, 'en-GB')).toBe('Every day until 1 Mar 2026')
  })
})
