import { describe, it, expect } from 'vitest'
import { currencyDecimals, formatMoney, fromMinorUnits, toMinorUnits } from '../../shared/lib/money'

describe('money in minor units', () => {
  it.each([
    [9.99, 'GBP', 999],
    [12.5, 'usd', 1250],
    [0.1 + 0.2, 'EUR', 30],
    [1000, 'JPY', 1000],
    [1.234, 'KWD', 1230],
  ])('%s %s is %s', (amount, currency, minor) => {
    expect(toMinorUnits(amount, currency)).toBe(minor)
  })

  it('goes back the other way without drift', () => {
    for (const minor of [1, 99, 1250, 999_999]) {
      expect(toMinorUnits(fromMinorUnits(minor, 'GBP'), 'GBP')).toBe(minor)
    }
    expect(fromMinorUnits(1000, 'JPY')).toBe(1000)
    expect(fromMinorUnits(1230, 'KWD')).toBe(1.23)
  })

  it('knows each currency\'s decimals', () => {
    expect(currencyDecimals('gbp')).toBe(2)
    expect(currencyDecimals('JPY')).toBe(0)
    expect(currencyDecimals('BHD')).toBe(3)
  })

  it('formats for display, and survives an unknown code', () => {
    expect(formatMoney(1250, 'GBP')).toBe('£12.50')
    expect(formatMoney(1000, 'JPY', 'en-GB')).toBe('JP¥1,000')
    expect(formatMoney(500, 'ZZ')).toBe('5.00 ZZ')
  })
})
