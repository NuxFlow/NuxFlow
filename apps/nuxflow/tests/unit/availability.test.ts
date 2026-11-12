import { describe, it, expect } from 'vitest'
import { addIsoDays, isValidIsoDate, mergeRanges, parseIcalRanges } from '../../shared/lib/ical-import'
import { availabilityMonths, isNightBooked } from '../../../../packages/canvas/src/utils/availability-calendar'
import { normalizeFeedUrl } from '../../server/utils/availability'

const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

describe('parseIcalRanges', () => {
  it('reads all-day stays the way Airbnb sends them', () => {
    const text = cal([
      'BEGIN:VEVENT',
      'DTEND;VALUE=DATE:20261205',
      'DTSTART;VALUE=DATE:20261201',
      'UID:abc@airbnb.com',
      'SUMMARY:Reserved',
      'END:VEVENT',
    ].join('\r\n'))
    expect(parseIcalRanges(text)).toEqual([{ start: '2026-12-01', end: '2026-12-05', summary: 'Reserved' }])
  })

  it('unfolds long lines and unescapes the summary', () => {
    const text = cal('BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20270110\r\nDTEND;VALUE=DATE:20270112\r\nSUMMARY:CLOSED - Not\r\n  available\\, sorry\r\nEND:VEVENT')
    expect(parseIcalRanges(text)[0]!.summary).toBe('CLOSED - Not available, sorry')
  })

  it('reads timed events by their date, makes a missing end one night, skips cancelled ones', () => {
    const text = cal([
      'BEGIN:VEVENT', 'DTSTART:20270301T150000Z', 'DTEND:20270303T100000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270310', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270320', 'DTEND;VALUE=DATE:20270322', 'STATUS:CANCELLED', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270330', 'DTEND;VALUE=DATE:20270328', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270231', 'END:VEVENT',
    ].join('\n'))
    expect(parseIcalRanges(text).map(r => [r.start, r.end])).toEqual([
      ['2027-03-01', '2027-03-03'],
      ['2027-03-10', '2027-03-11'],
    ])
  })

  it('stops at the cap', () => {
    const events = Array.from({ length: 30 }, (_, i) => `BEGIN:VEVENT\nDTSTART;VALUE=DATE:2027${String(1 + (i % 12)).padStart(2, '0')}01\nEND:VEVENT`).join('\n')
    expect(parseIcalRanges(cal(events), 5)).toHaveLength(5)
  })
})

describe('date helpers', () => {
  it('checks and adds dates in UTC', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true)
    expect(isValidIsoDate('2027-02-29')).toBe(false)
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addIsoDays('2027-03-28', 1)).toBe('2027-03-29')
  })

  it('merges overlapping and back-to-back stays', () => {
    expect(mergeRanges([
      { start: '2027-01-10', end: '2027-01-12' },
      { start: '2027-01-01', end: '2027-01-05' },
      { start: '2027-01-05', end: '2027-01-07' },
      { start: '2027-01-11', end: '2027-01-15' },
    ])).toEqual([{ start: '2027-01-01', end: '2027-01-07' }, { start: '2027-01-10', end: '2027-01-15' }])
  })
})

describe('availability calendar months', () => {
  const booked = [{ start: '2027-01-30', end: '2027-02-02' }]

  it('books the nights, not the leaving day', () => {
    expect(isNightBooked('2027-01-30', booked)).toBe(true)
    expect(isNightBooked('2027-02-01', booked)).toBe(true)
    expect(isNightBooked('2027-02-02', booked)).toBe(false)
  })

  it('builds months from today with the right first-weekday offset', () => {
    const [jan, feb] = availabilityMonths('2027-01-15', 2, booked, 1)
    expect(jan!.key).toBe('2027-01')
    // 1 January 2027 is a Friday: four blanks when weeks start on Monday, five on Sunday.
    expect(jan!.offset).toBe(4)
    expect(availabilityMonths('2027-01-15', 1, booked, 0)[0]!.offset).toBe(5)
    expect(jan!.days).toHaveLength(31)
    expect(jan!.days[13]).toMatchObject({ date: '2027-01-14', past: true })
    expect(jan!.days[29]).toMatchObject({ date: '2027-01-30', booked: true, past: false })
    expect(feb!.days.filter(x => x.booked).map(x => x.date)).toEqual(['2027-02-01'])
  })

  it('rolls over the year', () => {
    expect(availabilityMonths('2026-11-02', 3, []).map(m => m.key)).toEqual(['2026-11', '2026-12', '2027-01'])
  })
})

describe('normalizeFeedUrl', () => {
  it('takes https and webcal links, and nothing else', () => {
    expect(normalizeFeedUrl(' webcal://example.com/cal.ics ')).toBe('https://example.com/cal.ics')
    expect(normalizeFeedUrl('https://admin.booking.com/hotel/ical.html?t=abc')).toBe('https://admin.booking.com/hotel/ical.html?t=abc')
    expect(normalizeFeedUrl('http://example.com/cal.ics')).toBeNull()
    expect(normalizeFeedUrl('https://localhost/cal.ics')).toBeNull()
    expect(normalizeFeedUrl('https://10.0.0.1/cal.ics')).toBeNull()
    expect(normalizeFeedUrl('https://example.com:8443/cal.ics')).toBeNull()
    expect(normalizeFeedUrl('not a link')).toBeNull()
  })
})
