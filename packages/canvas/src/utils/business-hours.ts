// A business's address and opening hours (Settings → Business): the shared shapes and the
// pure rules — "open now", the week as text, schema.org data. Used by the Opening Hours
// block, the site layout's LocalBusiness data and the server. Import-free.
//
// Times are the site's own wall clock ("09:00" in the site's time zone, never UTC). A slot
// whose close is at or before its open runs past midnight (a bar's 18:00–02:00); "24:00"
// closes at midnight.

export const BUSINESS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type BusinessDay = typeof BUSINESS_DAYS[number]

export interface HoursSlot {
  open: string
  close: string
}

export interface HoursException {
  /** YYYY-MM-DD, in the site's time zone. */
  date: string
  /** Empty = closed all day. */
  slots: HoursSlot[]
  note?: string
}

export interface BusinessInfo {
  /** schema.org type: LocalBusiness or one of its subtypes (Restaurant, Plumber…). */
  kind: string
  /** Shown instead of the site name, when the business trades under another name. */
  name?: string
  phone?: string
  email?: string
  street?: string
  locality?: string
  region?: string
  postcode?: string
  /** ISO 3166-1 alpha-2, e.g. GB. */
  country?: string
  latitude?: number | null
  longitude?: number | null
  /** schema.org priceRange, e.g. "££". */
  priceRange?: string
  /** Weekly hours; a day with no slots is closed. */
  hours: Record<BusinessDay, HoursSlot[]>
  exceptions: HoursException[]
  /** A line shown under the hours, e.g. "Kitchen closes 30 minutes earlier." */
  hoursNote?: string
}

/** The schema.org types offered in Settings → Business, by label. */
export const BUSINESS_KINDS: Array<{ value: string; label: string }> = [
  { value: 'LocalBusiness', label: 'Local business (general)' },
  { value: 'Restaurant', label: 'Restaurant' },
  { value: 'CafeOrCoffeeShop', label: 'Café or coffee shop' },
  { value: 'Bakery', label: 'Bakery' },
  { value: 'BarOrPub', label: 'Bar or pub' },
  { value: 'FoodEstablishment', label: 'Other food or drink' },
  { value: 'Store', label: 'Shop' },
  { value: 'HairSalon', label: 'Hair salon' },
  { value: 'BeautySalon', label: 'Beauty salon' },
  { value: 'HealthAndBeautyBusiness', label: 'Health and beauty' },
  { value: 'ExerciseGym', label: 'Gym or fitness studio' },
  { value: 'MedicalBusiness', label: 'Medical or therapy practice' },
  { value: 'Electrician', label: 'Electrician' },
  { value: 'Plumber', label: 'Plumber' },
  { value: 'HVACBusiness', label: 'Heating and air conditioning' },
  { value: 'RoofingContractor', label: 'Roofer' },
  { value: 'GeneralContractor', label: 'Builder' },
  { value: 'HousePainter', label: 'Painter and decorator' },
  { value: 'HomeAndConstructionBusiness', label: 'Other trade or home service' },
  { value: 'Locksmith', label: 'Locksmith' },
  { value: 'AutoRepair', label: 'Garage or car repair' },
  { value: 'LegalService', label: 'Solicitor or legal service' },
  { value: 'AccountingService', label: 'Accountant' },
  { value: 'RealEstateAgent', label: 'Estate agent' },
  { value: 'ProfessionalService', label: 'Other professional service' },
  { value: 'LodgingBusiness', label: 'Hotel, B&B or holiday let' },
]

const KINDS = new Set(BUSINESS_KINDS.map(k => k.value))
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function emptyHours(): Record<BusinessDay, HoursSlot[]> {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

function coord(v: unknown, limit: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? n : null
}

function slots(v: unknown): HoursSlot[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s): s is HoursSlot => !!s && typeof s === 'object' && TIME.test(String((s as HoursSlot).open)) && TIME.test(String((s as HoursSlot).close)) && (s as HoursSlot).open !== '24:00')
    .slice(0, 4)
    .map(s => ({ open: s.open, close: s.close }))
}

/**
 * Reads a stored profile leniently, field by field — bad values are dropped, never thrown —
 * so a hand-edited or older setting can't break every page. Null when nothing is set.
 */
export function parseBusinessInfo(value: unknown): BusinessInfo | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const hoursIn = (v.hours && typeof v.hours === 'object' ? v.hours : {}) as Record<string, unknown>
  const hours = emptyHours()
  for (const day of BUSINESS_DAYS) hours[day] = slots(hoursIn[day])
  const exceptions = (Array.isArray(v.exceptions) ? v.exceptions : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && DATE.test(String((e as HoursException).date)))
    .slice(0, 100)
    .map(e => ({ date: String(e.date), slots: slots(e.slots), ...(str(e.note, 120) ? { note: str(e.note, 120) } : {}) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return {
    kind: typeof v.kind === 'string' && KINDS.has(v.kind) ? v.kind : 'LocalBusiness',
    name: str(v.name, 120),
    phone: str(v.phone, 40),
    email: str(v.email, 200),
    street: str(v.street, 200),
    locality: str(v.locality, 100),
    region: str(v.region, 100),
    postcode: str(v.postcode, 20),
    country: str(v.country, 2)?.toUpperCase(),
    latitude: coord(v.latitude, 90),
    longitude: coord(v.longitude, 180),
    priceRange: str(v.priceRange, 20),
    hours,
    exceptions,
    hoursNote: str(v.hoursNote, 200),
  }
}

export function hasAnyHours(info: BusinessInfo | null | undefined): boolean {
  return !!info && BUSINESS_DAYS.some(d => info.hours[d].length > 0)
}

// ── Time arithmetic ─────────────────────────────────────────────────────────

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** Whether a slot runs past midnight into the next day. */
function overnight(s: HoursSlot): boolean {
  return s.close !== '24:00' && minutes(s.close) <= minutes(s.open)
}

/** The site's wall clock at `now`: date, day and minute of the day. */
export function siteClock(now: Date, timeZone: string): { date: string; day: BusinessDay; minute: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  }
  catch {
    return siteClock(now, 'UTC')
  }
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const day = get('weekday').slice(0, 3).toLowerCase() as BusinessDay
  return { date: `${get('year')}-${get('month')}-${get('day')}`, day, minute: Number(get('hour')) * 60 + Number(get('minute')) }
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dayOf(date: string): BusinessDay {
  return BUSINESS_DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!
}

/** The slots that apply on a date: its exception, or that weekday's usual hours. */
export function slotsOn(info: BusinessInfo, date: string): { slots: HoursSlot[]; exception?: HoursException } {
  const exception = info.exceptions.find(e => e.date === date)
  return exception ? { slots: exception.slots, exception } : { slots: info.hours[dayOf(date)] }
}

export type OpenStatus =
  | { open: true; closesAt: string }
  | { open: false; opensAt: { date: string; time: string; daysAhead: number } | null }

/**
 * Open or closed at `now` (site time zone), with when that changes. Null when no hours are
 * set at all, so the block can show nothing rather than "Closed".
 */
export function openStatus(info: BusinessInfo, timeZone: string, now: Date): OpenStatus | null {
  if (!hasAnyHours(info) && !info.exceptions.some(e => e.slots.length)) return null
  const clock = siteClock(now, timeZone)

  // Still inside last night's late slot?
  for (const s of slotsOn(info, addDays(clock.date, -1)).slots) {
    if (overnight(s) && clock.minute < minutes(s.close)) return { open: true, closesAt: s.close }
  }
  for (const s of slotsOn(info, clock.date).slots) {
    const end = s.close === '24:00' || overnight(s) ? 24 * 60 : minutes(s.close)
    if (clock.minute >= minutes(s.open) && clock.minute < end) return { open: true, closesAt: s.close }
  }
  for (let ahead = 0; ahead <= 14; ahead++) {
    const date = addDays(clock.date, ahead)
    const next = slotsOn(info, date).slots
      .filter(s => ahead > 0 || minutes(s.open) > clock.minute)
      .sort((a, b) => minutes(a.open) - minutes(b.open))[0]
    if (next) return { open: false, opensAt: { date, time: next.open, daysAhead: ahead } }
  }
  return { open: false, opensAt: null }
}

// ── Text ────────────────────────────────────────────────────────────────────

/** "9:00 am" / "09:00", by the locale's own clock convention. */
export function formatTime(hhmm: string, locale = 'en'): string {
  if (hhmm === '24:00') hhmm = '00:00'
  const [h, m] = hhmm.split(':').map(Number)
  try {
    // 24-hour locales write "09:00", 12-hour ones "9:00 am".
    const h12 = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12
    return new Intl.DateTimeFormat(locale, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, h, m)))
  }
  catch {
    return hhmm
  }
}

export function formatSlots(list: HoursSlot[], locale = 'en'): string {
  return list.length ? list.map(s => `${formatTime(s.open, locale)} – ${formatTime(s.close, locale)}`).join(', ') : 'Closed'
}

/** A weekday's name in the locale, "mon" → "Monday". */
export function dayName(day: BusinessDay, locale = 'en', width: 'long' | 'short' = 'long'): string {
  // 2024-01-01 was a Monday.
  const date = new Date(Date.UTC(2024, 0, 1 + BUSINESS_DAYS.indexOf(day)))
  try {
    return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(date)
  }
  catch {
    return day
  }
}

/** "Open now · closes 5:00 pm" / "Closed · opens tomorrow 9:00 am". */
export function statusText(status: OpenStatus, locale = 'en'): string {
  if (status.open) return `Open now · closes ${formatTime(status.closesAt, locale)}`
  if (!status.opensAt) return 'Closed'
  const { daysAhead, date, time } = status.opensAt
  const when = daysAhead === 0 ? '' : daysAhead === 1 ? 'tomorrow ' : `${dayName(dayOf(date), locale)} `
  return `Closed · opens ${when}${formatTime(time, locale)}`
}

/** Exceptions from `today` on, soonest first, at most `limit` of them. */
export function upcomingExceptions(info: BusinessInfo, today: string, limit = 5): HoursException[] {
  return info.exceptions.filter(e => e.date >= today).slice(0, limit)
}

// ── schema.org ──────────────────────────────────────────────────────────────

const SCHEMA_DAYS: Record<BusinessDay, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

function schemaClose(t: string): string {
  return t === '24:00' ? '23:59' : t
}

/**
 * openingHoursSpecification for schema.org/LocalBusiness: one entry per distinct slot with
 * the days that share it, then dated entries for upcoming exceptions (closed = 00:00–00:00,
 * as Google documents).
 */
export function openingHoursSpecification(info: BusinessInfo, today: string): Array<Record<string, unknown>> {
  const bySlot = new Map<string, { days: string[]; slot: HoursSlot }>()
  for (const day of BUSINESS_DAYS) {
    for (const slot of info.hours[day]) {
      const key = `${slot.open}-${slot.close}`
      const entry = bySlot.get(key) ?? { days: [], slot }
      entry.days.push(SCHEMA_DAYS[day])
      bySlot.set(key, entry)
    }
  }
  const weekly = [...bySlot.values()].map(({ days, slot }) => ({
    '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: slot.open, closes: schemaClose(slot.close),
  }))
  const special = upcomingExceptions(info, today, 20).flatMap(e => (e.slots.length ? e.slots : [{ open: '00:00', close: '00:00' }]).map(s => ({
    '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: s.open, closes: schemaClose(s.close),
  })))
  return [...weekly, ...special]
}

/** The schema.org properties a business adds to the site's Organization node. */
export function localBusinessJsonLd(info: BusinessInfo, today: string): Record<string, unknown> {
  const address = [info.street, info.locality, info.region, info.postcode, info.country].some(Boolean)
    ? {
        '@type': 'PostalAddress',
        ...(info.street ? { streetAddress: info.street } : {}),
        ...(info.locality ? { addressLocality: info.locality } : {}),
        ...(info.region ? { addressRegion: info.region } : {}),
        ...(info.postcode ? { postalCode: info.postcode } : {}),
        ...(info.country ? { addressCountry: info.country } : {}),
      }
    : undefined
  const hours = openingHoursSpecification(info, today)
  return {
    '@type': info.kind,
    ...(info.name ? { name: info.name } : {}),
    ...(info.phone ? { telephone: info.phone } : {}),
    ...(info.email ? { email: info.email } : {}),
    ...(address ? { address } : {}),
    ...(info.latitude != null && info.longitude != null ? { geo: { '@type': 'GeoCoordinates', latitude: info.latitude, longitude: info.longitude } } : {}),
    ...(info.priceRange ? { priceRange: info.priceRange } : {}),
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
  }
}

/** One line of the address, for display. */
export function addressLine(info: BusinessInfo): string {
  return [info.street, info.locality, info.region, info.postcode].filter(Boolean).join(', ')
}
