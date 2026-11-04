import { describe, it, expect } from 'vitest'
import {
  addDays,
  buildIcsCalendar,
  daysBetween,
  escapeIcsText,
  eventDay,
  eventDayRange,
  eventDays,
  eventHasEnded,
  eventHasStarted,
  foldIcsLine,
  formatEventWhen,
  parseStoredDate,
  todayIn,
  utcToZoned,
  zonedToUtc,
} from '@nuxflow/canvas/events'

const LONDON = 'Europe/London'
const NEW_YORK = 'America/New_York'

describe('site time zone conversion', () => {
  it('reads a wall clock in the site zone, summer and winter', () => {
    expect(zonedToUtc('2027-07-15T18:00', LONDON)).toBe('2027-07-15T17:00:00.000Z')
    expect(zonedToUtc('2027-01-15T18:00', LONDON)).toBe('2027-01-15T18:00:00.000Z')
    expect(zonedToUtc('2027-07-15T18:00', NEW_YORK)).toBe('2027-07-15T22:00:00.000Z')
  })

  it('never moves a time when it is opened and saved over and over', () => {
    // The original bug: 18:00 became 17:00, 16:00, 15:00… in UK summer time.
    for (const zone of [LONDON, NEW_YORK, 'Asia/Kolkata', 'UTC']) {
      let stored = zonedToUtc('2027-07-15T18:00', zone)!
      for (let i = 0; i < 5; i++) stored = zonedToUtc(utcToZoned(stored, zone), zone)!
      expect(utcToZoned(stored, zone)).toBe('2027-07-15T18:00')
    }
  })

  it('handles times right next to a clock change', () => {
    // UK clocks went back at 02:00 BST on 2027-10-31.
    expect(utcToZoned(zonedToUtc('2027-10-30T18:00', LONDON), LONDON)).toBe('2027-10-30T18:00')
    expect(utcToZoned(zonedToUtc('2027-10-31T18:00', LONDON), LONDON)).toBe('2027-10-31T18:00')
    expect(utcToZoned(zonedToUtc('2027-03-28T12:00', LONDON), LONDON)).toBe('2027-03-28T12:00')
  })

  it('refuses a value that is not a date, and survives an unknown zone', () => {
    expect(zonedToUtc('', LONDON)).toBeNull()
    expect(zonedToUtc('tomorrow', LONDON)).toBeNull()
    expect(utcToZoned('nonsense', LONDON)).toBe('')
    expect(utcToZoned('2027-07-15T17:00:00.000Z', 'Mars/Olympus')).toBe('2027-07-15T17:00')
  })

  it('reads both stored date forms as UTC', () => {
    expect(parseStoredDate('2026-11-04 12:30:00')?.toISOString()).toBe('2026-11-04T12:30:00.000Z')
    expect(parseStoredDate('2026-11-04T12:30:00.000Z')?.toISOString()).toBe('2026-11-04T12:30:00.000Z')
    expect(parseStoredDate('garbage')).toBeNull()
  })
})

describe('event days', () => {
  it('keeps an all-day date whatever the zone', () => {
    for (const zone of [LONDON, NEW_YORK, 'Pacific/Auckland']) {
      expect(eventDay('2027-07-15T00:00:00.000Z', true, zone)).toBe('2027-07-15')
    }
  })

  it('recovers the date older all-day rows meant', () => {
    // Saved as the author's local midnight, an hour before UTC midnight in summer.
    expect(eventDay('2027-07-14T23:00:00.000Z', true, LONDON)).toBe('2027-07-15')
  })

  it('puts a timed event on the day it falls in the site zone', () => {
    expect(eventDay('2027-07-15T23:30:00.000Z', false, LONDON)).toBe('2027-07-16')
    expect(eventDay('2027-07-16T02:00:00.000Z', false, NEW_YORK)).toBe('2027-07-15')
  })

  it('lists every day of a long event, capped', () => {
    expect(eventDays({ eventStartAt: '2027-07-30T00:00:00.000Z', eventEndAt: '2027-08-01T00:00:00.000Z', eventAllDay: true }, LONDON))
      .toEqual(['2027-07-30', '2027-07-31', '2027-08-01'])
    expect(eventDays({ eventStartAt: '2027-01-01T00:00:00.000Z', eventEndAt: '2099-01-01T00:00:00.000Z', eventAllDay: true }, LONDON)).toHaveLength(62)
  })

  it('does not count an end at midnight as another day', () => {
    expect(eventDayRange({ eventStartAt: '2027-01-15T20:00:00.000Z', eventEndAt: '2027-01-16T00:00:00.000Z' }, LONDON))
      .toEqual({ first: '2027-01-15', last: '2027-01-15' })
  })

  it('does days arithmetic across months', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(daysBetween('2027-02-28', '2027-03-02')).toBe(2)
  })

  it('knows when a multi-day event is over, and when it began', () => {
    const conference = { eventStartAt: '2027-07-10T00:00:00.000Z', eventEndAt: '2027-07-12T00:00:00.000Z', eventAllDay: true }
    const during = new Date('2027-07-11T12:00:00.000Z')
    expect(eventHasStarted(conference, LONDON, during)).toBe(true)
    expect(eventHasEnded(conference, LONDON, during)).toBe(false)
    expect(eventHasEnded(conference, LONDON, new Date('2027-07-12T22:00:00.000Z'))).toBe(false)
    expect(eventHasEnded(conference, LONDON, new Date('2027-07-13T00:30:00.000Z'))).toBe(true)
  })

  it('gets today right near midnight in the site zone', () => {
    expect(todayIn(LONDON, new Date('2027-07-15T23:30:00.000Z'))).toBe('2027-07-16')
    expect(todayIn(NEW_YORK, new Date('2027-07-16T02:00:00.000Z'))).toBe('2027-07-15')
  })
})

describe('formatEventWhen', () => {
  it('shows a timed event in the site zone, labelled', () => {
    const text = formatEventWhen({ eventStartAt: '2027-07-15T17:00:00.000Z', eventEndAt: '2027-07-15T19:00:00.000Z' }, LONDON, 'en-GB')
    expect(text).toContain('15 Jul 2027')
    expect(text).toContain('18:00')
    expect(text).toContain('20:00')
    expect(text).toContain('BST')
  })

  it('shows all-day events as dates only', () => {
    const text = formatEventWhen({ eventStartAt: '2027-07-15T00:00:00.000Z', eventAllDay: true }, NEW_YORK, 'en-GB')
    expect(text).toContain('15 Jul 2027')
    expect(text).not.toMatch(/\d{2}:\d{2}/)
  })

  it('is empty for a date it cannot read', () => {
    expect(formatEventWhen({ eventStartAt: 'garbage' }, LONDON)).toBe('')
  })
})

describe('calendar files', () => {
  const base = { domain: 'example.com', timeZone: LONDON }

  it('writes a valid timestamp from a stored datetime(\'now\') value', () => {
    // The original bug: DTSTAMP:20261104 123000Z, with a space in it.
    const ics = buildIcsCalendar({ ...base, events: [{ id: 'a', title: 'T', eventStartAt: '2027-07-15T17:00:00.000Z', updatedAt: '2026-11-04 12:30:00' }] })
    expect(ics).toContain('DTSTAMP:20261104T123000Z\r\n')
    expect(ics).toContain('DTSTART:20270715T170000Z\r\n')
    expect(ics).toContain('DTEND:20270715T180000Z\r\n')
  })

  it('writes all-day events as dates, with the day after the last as the end', () => {
    const ics = buildIcsCalendar({ ...base, events: [{ id: 'a', title: 'T', eventStartAt: '2027-07-15T00:00:00.000Z', eventEndAt: '2027-07-17T00:00:00.000Z', eventAllDay: true }] })
    expect(ics).toContain('DTSTART;VALUE=DATE:20270715\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20270718\r\n')
  })

  it('leaves out an event with a bad date instead of failing the whole feed', () => {
    const ics = buildIcsCalendar({ ...base, events: [
      { id: 'bad', title: 'Bad', eventStartAt: 'not a date' },
      { id: 'good', title: 'Good', eventStartAt: '2027-07-15T17:00:00.000Z' },
    ] })
    expect(ics).toContain('SUMMARY:Good')
    expect(ics).not.toContain('SUMMARY:Bad')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  })

  it('escapes text, so a line break cannot add calendar fields', () => {
    expect(escapeIcsText('a,b;c\\d\r\nSTATUS:CANCELLED')).toBe('a\\,b\\;c\\\\d\\nSTATUS:CANCELLED')
  })

  it('leaves out a link that is not a plain web address', () => {
    const ics = buildIcsCalendar({ ...base, events: [{ id: 'a', title: 'T', eventStartAt: '2027-07-15T17:00:00.000Z', url: 'https://x.test/\r\nATTENDEE:evil' }] })
    expect(ics).not.toContain('ATTENDEE')
    expect(ics).not.toContain('URL:')
  })

  it('folds long lines without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(100)}`
    const folded = foldIcsLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line)
    expect(foldIcsLine('short')).toBe('short')
  })
})
