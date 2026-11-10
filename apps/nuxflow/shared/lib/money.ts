/**
 * Money as whole minor units — pence, cents, or the whole unit for zero-decimal currencies
 * such as yen — exactly the numbers Stripe uses. Import-free, shared by the server and the
 * browser. Every new table stores these; the older booking and pass columns hold decimals and
 * are converted at the edges with `toMinorUnits()`/`fromMinorUnits()`.
 */

// https://docs.stripe.com/currencies#zero-decimal and #three-decimal
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

/** Digits after the decimal point. */
export function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase()
  if (ZERO_DECIMAL.has(code)) return 0
  if (THREE_DECIMAL.has(code)) return 3
  return 2
}

/**
 * A decimal amount (9.99) in minor units (999). Three-decimal currencies use thousandths with
 * the last digit 0, as Stripe requires.
 */
export function toMinorUnits(amount: number, currency: string): number {
  const decimals = currencyDecimals(currency)
  if (decimals === 0) return Math.round(amount)
  if (decimals === 3) return Math.round(amount * 100) * 10
  return Math.round(amount * 100)
}

/** Minor units back to a decimal amount, for the older decimal columns and for display. */
export function fromMinorUnits(minor: number, currency: string): number {
  const decimals = currencyDecimals(currency)
  return decimals === 0 ? minor : minor / 10 ** decimals
}

/** "£12.50", in the given locale (the site's, for anything rendered on the server). */
export function formatMoney(minor: number, currency: string, locale = 'en-GB'): string {
  const code = currency.toUpperCase()
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(fromMinorUnits(minor, code))
  }
  catch {
    return `${fromMinorUnits(minor, code).toFixed(currencyDecimals(code))} ${code}`
  }
}

/** A three-letter ISO currency code, upper case. */
export const CURRENCY_RE = /^[A-Z]{3}$/
