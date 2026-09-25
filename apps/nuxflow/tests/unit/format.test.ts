import { describe, it, expect } from 'vitest'
import { parseDbDate } from '../../app/utils/format'

describe('parseDbDate', () => {
  it('reads a D1 datetime() string as UTC', () => {
    expect(parseDbDate('2026-09-25 14:03:00').toISOString()).toBe('2026-09-25T14:03:00.000Z')
  })

  it('leaves strings that already carry a zone alone', () => {
    expect(parseDbDate('2026-09-25T14:03:00Z').toISOString()).toBe('2026-09-25T14:03:00.000Z')
    expect(parseDbDate('2026-09-25T14:03:00+02:00').toISOString()).toBe('2026-09-25T12:03:00.000Z')
  })
})
