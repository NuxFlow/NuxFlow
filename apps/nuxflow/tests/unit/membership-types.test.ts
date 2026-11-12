import { describe, it, expect } from 'vitest'
import { tierIntervalLabel } from '../../shared/lib/membership-types'

describe('tierIntervalLabel', () => {
  it('gives the short label shown after a price', () => {
    expect(tierIntervalLabel('month')).toBe('mo')
    expect(tierIntervalLabel('year')).toBe('yr')
    // The paywall and account page used to print the raw value: "£20 / one_time".
    expect(tierIntervalLabel('one_time')).toBe('once')
  })

  it('passes an unknown value through rather than hiding it', () => {
    expect(tierIntervalLabel('week')).toBe('week')
  })
})
