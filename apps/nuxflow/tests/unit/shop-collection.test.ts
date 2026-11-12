import { describe, it, expect } from 'vitest'
import { emptyHours, type BusinessInfo } from '@nuxflow/canvas/business'
import { collectionDays, formatCollectAt, isCollectionChoice } from '../../shared/lib/shop-collection'

function shop(overrides: Partial<BusinessInfo> = {}): BusinessInfo {
  const hours = emptyHours()
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) hours[d] = [{ open: '09:00', close: '10:00' }]
  return { kind: 'Bakery', hours, exceptions: [], ...overrides }
}

// 2026-11-11 is a Wednesday; London is on GMT then.
const wed0900 = new Date('2026-11-11T09:00:00Z')

describe('collectionDays', () => {
  it('offers quarter-hours in opening hours, after the notice', () => {
    const days = collectionDays({ info: shop(), timeZone: 'Europe/London', leadMinutes: 30, days: 1, now: wed0900, locale: 'en-GB' })
    expect(days).toEqual([
      { date: '2026-11-11', label: 'Wed 11 Nov', times: ['09:30', '09:45'] },
      { date: '2026-11-12', label: 'Thu 12 Nov', times: ['09:00', '09:15', '09:30', '09:45'] },
    ])
  })

  it('skips closed days and holidays', () => {
    const fri = new Date('2026-11-13T12:00:00Z')
    const days = collectionDays({ info: shop({ exceptions: [{ date: '2026-11-16', slots: [] }] }), timeZone: 'UTC', leadMinutes: 0, days: 4, now: fri })
    expect(days.map(d => d.date)).toEqual(['2026-11-17'])
  })

  it('offers whole days when no opening hours are set', () => {
    const days = collectionDays({ info: null, timeZone: 'UTC', leadMinutes: 24 * 60, days: 2, now: wed0900 })
    expect(days.map(d => [d.date, d.times])).toEqual([['2026-11-12', []], ['2026-11-13', []]])
  })
})

describe('choices', () => {
  const days = collectionDays({ info: shop(), timeZone: 'UTC', leadMinutes: 0, days: 0, now: wed0900 })

  it('accepts only an offered day and time', () => {
    expect(isCollectionChoice(days, '2026-11-11T09:15')).toBe(true)
    expect(isCollectionChoice(days, '2026-11-11T08:00')).toBe(false)
    expect(isCollectionChoice(days, '2026-11-11')).toBe(false)
    expect(isCollectionChoice(days, '2026-11-12T09:15')).toBe(false)
  })

  it('reads well', () => {
    expect(formatCollectAt('2026-11-18T14:30', 'en-GB')).toBe('Wed 18 Nov, 14:30')
    expect(formatCollectAt('2026-11-18', 'en-GB')).toBe('Wed 18 Nov')
  })
})
