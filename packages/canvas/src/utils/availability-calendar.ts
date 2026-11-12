/**
 * Month grids for the Availability calendar block. Import-free and pure, so tests can check
 * it. Dates are YYYY-MM-DD strings compared as text; a booked range covers the nights from
 * `start` up to, not including, `end` (the day the guests leave — free for the next arrival).
 */

export interface CalendarDay {
  date: string
  day: number
  booked: boolean
  past: boolean
}

export interface CalendarMonth {
  /** YYYY-MM */
  key: string
  year: number
  /** 0–11 */
  month: number
  /** Leading blanks before the 1st, for the chosen first weekday. */
  offset: number
  days: CalendarDay[]
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function isNightBooked(date: string, booked: Array<{ start: string; end: string }>): boolean {
  return booked.some(r => r.start <= date && date < r.end)
}

/**
 * `count` months starting with the month `today` is in. `weekStart` 1 = Monday, 0 = Sunday.
 */
export function availabilityMonths(today: string, count: number, booked: Array<{ start: string; end: string }>, weekStart: 0 | 1 = 1): CalendarMonth[] {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const months: CalendarMonth[] = []
  for (let i = 0; i < Math.max(1, Math.min(24, count)); i++) {
    const first = new Date(Date.UTC(y, m - 1 + i, 1))
    const year = first.getUTCFullYear()
    const month = first.getUTCMonth()
    const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const offset = (first.getUTCDay() - weekStart + 7) % 7
    const days: CalendarDay[] = []
    for (let d = 1; d <= daysIn; d++) {
      const date = `${year}-${pad(month + 1)}-${pad(d)}`
      days.push({ date, day: d, booked: isNightBooked(date, booked), past: date < today })
    }
    months.push({ key: `${year}-${pad(month + 1)}`, year, month, offset, days })
  }
  return months
}
