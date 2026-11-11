import { describe, it, expect } from 'vitest'
import {
  emptyHours,
  formatTime,
  localBusinessJsonLd,
  openStatus,
  openingHoursSpecification,
  parseBusinessInfo,
  statusText,
  type BusinessInfo,
} from '@nuxflow/canvas/business'

const nineToFive = { open: '09:00', close: '17:00' }

function cafe(overrides: Partial<BusinessInfo> = {}): BusinessInfo {
  const hours = emptyHours()
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) hours[d] = [nineToFive]
  hours.sat = [{ open: '10:00', close: '14:00' }]
  return { kind: 'CafeOrCoffeeShop', hours, exceptions: [], ...overrides }
}

// 2026-11-11 is a Wednesday. London is on GMT in November, so UTC = local.
const at = (iso: string) => new Date(iso)

describe('openStatus', () => {
  it('is open inside a slot, with its closing time', () => {
    expect(openStatus(cafe(), 'Europe/London', at('2026-11-11T12:00:00Z'))).toEqual({ open: true, closesAt: '17:00' })
  })

  it('is closed at the closing minute and says when it next opens', () => {
    expect(openStatus(cafe(), 'Europe/London', at('2026-11-11T17:00:00Z')))
      .toEqual({ open: false, opensAt: { date: '2026-11-12', time: '09:00', daysAhead: 1 } })
  })

  it('opens later today before the first slot', () => {
    expect(openStatus(cafe(), 'Europe/London', at('2026-11-11T07:30:00Z')))
      .toEqual({ open: false, opensAt: { date: '2026-11-11', time: '09:00', daysAhead: 0 } })
  })

  it('skips closed days (Saturday afternoon → Monday)', () => {
    const s = openStatus(cafe(), 'Europe/London', at('2026-11-14T15:00:00Z'))
    expect(s).toEqual({ open: false, opensAt: { date: '2026-11-16', time: '09:00', daysAhead: 2 } })
  })

  it('works in the site\'s time zone, not UTC', () => {
    // 08:30 UTC = 09:30 in Paris.
    expect(openStatus(cafe(), 'Europe/Paris', at('2026-11-11T08:30:00Z'))?.open).toBe(true)
    expect(openStatus(cafe(), 'Europe/London', at('2026-11-11T08:30:00Z'))?.open).toBe(false)
  })

  it('handles a slot past midnight on both sides of it', () => {
    const hours = emptyHours()
    hours.fri = [{ open: '18:00', close: '02:00' }]
    const bar = cafe({ hours })
    expect(openStatus(bar, 'UTC', at('2026-11-13T23:00:00Z'))).toEqual({ open: true, closesAt: '02:00' })
    expect(openStatus(bar, 'UTC', at('2026-11-14T01:30:00Z'))).toEqual({ open: true, closesAt: '02:00' })
    expect(openStatus(bar, 'UTC', at('2026-11-14T02:00:00Z'))?.open).toBe(false)
  })

  it('treats 24:00 as midnight', () => {
    const hours = emptyHours()
    hours.wed = [{ open: '20:00', close: '24:00' }]
    expect(openStatus(cafe({ hours }), 'UTC', at('2026-11-11T23:59:00Z'))?.open).toBe(true)
    expect(openStatus(cafe({ hours }), 'UTC', at('2026-11-12T00:00:00Z'))?.open).toBe(false)
  })

  it('follows a holiday exception over the usual hours', () => {
    const closed = cafe({ exceptions: [{ date: '2026-11-11', slots: [] }] })
    expect(openStatus(closed, 'UTC', at('2026-11-11T12:00:00Z'))?.open).toBe(false)
    const short = cafe({ exceptions: [{ date: '2026-11-15', slots: [{ open: '11:00', close: '13:00' }] }] })
    expect(openStatus(short, 'UTC', at('2026-11-15T12:00:00Z'))).toEqual({ open: true, closesAt: '13:00' })
  })

  it('is null when no hours are set', () => {
    expect(openStatus(cafe({ hours: emptyHours() }), 'UTC', at('2026-11-11T12:00:00Z'))).toBeNull()
  })
})

describe('text', () => {
  it('formats times by the locale\'s convention', () => {
    expect(formatTime('17:30', 'en-GB')).toBe('17:30')
    expect(formatTime('17:30', 'en-US')).toMatch(/5:30\s?PM/i)
    expect(formatTime('24:00', 'en-GB')).toBe('00:00')
  })

  it('describes the status', () => {
    expect(statusText({ open: true, closesAt: '17:00' }, 'en-GB')).toBe('Open now · closes 17:00')
    expect(statusText({ open: false, opensAt: { date: '2026-11-12', time: '09:00', daysAhead: 1 } }, 'en-GB')).toBe('Closed · opens tomorrow 09:00')
    expect(statusText({ open: false, opensAt: { date: '2026-11-16', time: '09:00', daysAhead: 5 } }, 'en-GB')).toBe('Closed · opens Monday 09:00')
  })
})

describe('parseBusinessInfo', () => {
  it('drops bad values instead of failing', () => {
    const info = parseBusinessInfo({
      kind: 'NotAType',
      phone: '  01904 123456 ',
      country: 'gb',
      latitude: '53.96',
      longitude: 'east',
      hours: { mon: [{ open: '09:00', close: '17:00' }, { open: '9am', close: '5pm' }], funday: [nineToFive] },
      exceptions: [{ date: '2026-12-25', slots: [] }, { date: 'Christmas' }],
    })!
    expect(info.kind).toBe('LocalBusiness')
    expect(info.phone).toBe('01904 123456')
    expect(info.country).toBe('GB')
    expect(info.latitude).toBe(53.96)
    expect(info.longitude).toBeNull()
    expect(info.hours.mon).toEqual([nineToFive])
    expect(info.exceptions).toEqual([{ date: '2026-12-25', slots: [] }])
  })

  it('is null for nothing', () => {
    expect(parseBusinessInfo(null)).toBeNull()
    expect(parseBusinessInfo('x')).toBeNull()
  })
})

describe('schema.org', () => {
  it('groups days that share hours, and lists upcoming exceptions', () => {
    const info = cafe({ exceptions: [{ date: '2026-01-01', slots: [] }, { date: '2026-12-25', slots: [] }] })
    const spec = openingHoursSpecification(info, '2026-11-11')
    expect(spec[0]).toEqual({ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:00' })
    expect(spec[1]).toMatchObject({ dayOfWeek: ['Saturday'], opens: '10:00', closes: '14:00' })
    expect(spec.slice(2)).toEqual([{ '@type': 'OpeningHoursSpecification', validFrom: '2026-12-25', validThrough: '2026-12-25', opens: '00:00', closes: '00:00' }])
  })

  it('builds a LocalBusiness with address, phone and geo', () => {
    const ld = localBusinessJsonLd(cafe({ phone: '01904 1', street: '10 High St', locality: 'York', postcode: 'YO1', country: 'GB', latitude: 53.9, longitude: -1.08 }), '2026-11-11')
    expect(ld['@type']).toBe('CafeOrCoffeeShop')
    expect(ld.telephone).toBe('01904 1')
    expect(ld.address).toEqual({ '@type': 'PostalAddress', streetAddress: '10 High St', addressLocality: 'York', postalCode: 'YO1', addressCountry: 'GB' })
    expect(ld.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 53.9, longitude: -1.08 })
  })
})
