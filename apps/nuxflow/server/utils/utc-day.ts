const DAY_MS = 86_400_000

/**
 * `YYYY-MM-DD` in UTC — the day key every daily counter (`site_usage_daily`, `crawler_hits`)
 * is stored under, and the date stamped on downloaded files.
 */
export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

/** The UTC day `days` days before `now`. */
export function utcDayAgo(days: number, now = new Date()): string {
  return utcDay(new Date(now.getTime() - days * DAY_MS))
}
