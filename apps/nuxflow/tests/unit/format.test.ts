import { describe, it, expect } from 'vitest'
import { formatDate, formatLocalDate, formatLocalDateTime, parseDbDate } from '../../app/utils/format'

describe('parseDbDate', () => {
  it('reads a D1 datetime() string as UTC', () => {
    expect(parseDbDate('2026-09-25 14:03:00').toISOString()).toBe('2026-09-25T14:03:00.000Z')
  })

  it('leaves strings that already carry a zone alone', () => {
    expect(parseDbDate('2026-09-25T14:03:00Z').toISOString()).toBe('2026-09-25T14:03:00.000Z')
    expect(parseDbDate('2026-09-25T14:03:00+02:00').toISOString()).toBe('2026-09-25T12:03:00.000Z')
  })
})

describe('formatDate', () => {
  it('formats a D1 datetime() string in UTC, whatever the local timezone', () => {
    expect(formatDate('2026-09-25 23:30:00')).toBe('September 25, 2026')
    expect(formatDate('2026-09-25T23:30:00Z')).toBe('September 25, 2026')
  })

  it('returns the fallback for missing or unparseable values', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('', '')).toBe('')
    expect(formatDate('not a date', 'n/a')).toBe('n/a')
  })
})

describe('formatLocalDate / formatLocalDateTime', () => {
  it('formats D1 datetime() strings instead of producing Invalid Date', () => {
    expect(formatLocalDate('2026-09-25 14:03:00')).not.toMatch(/invalid/i)
    expect(formatLocalDateTime('2026-09-25 14:03:00')).not.toMatch(/invalid/i)
  })

  it('returns the fallback for missing values', () => {
    expect(formatLocalDate(undefined, 'Never')).toBe('Never')
    expect(formatLocalDateTime(null)).toBe('—')
  })
})
