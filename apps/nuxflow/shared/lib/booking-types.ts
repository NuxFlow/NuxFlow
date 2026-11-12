// Visitor-facing booking shapes: event RSVPs and paid places (server/utils/event-rsvp.ts),
// one-to-one appointments (server/utils/appointments.ts) and a visitor's own list
// (/booking/my). The server functions that build them are declared to return these.
// Import-free.

// ── Events ──────────────────────────────────────────────────────────────────

export type RsvpStatus = 'pending' | 'held' | 'offered' | 'confirmed' | 'waitlist' | 'cancelled'
/** Whether a date can still be booked: places left, waitlist only, or not at all. */
export type RsvpState = 'open' | 'waitlist' | 'closed'
export type BookingMethod = 'card' | 'pass'

/** One date of a repeating event, as the booking form lists it. */
export interface BookableDate {
  date: string
  when: string
  state: RsvpState
  spotsLeft: number | null
  maxSeats: number
}

/** What an event's booking form needs (publicRsvpState()). The page is cached, so this is fetched live. */
export interface RsvpPublicState {
  enabled: boolean
  state: RsvpState
  spotsLeft: number | null
  maxSeats: number
  price: number | null
  currency: string | null
  canPayByCard: boolean
  canUsePass: boolean
  cancelHours: number | null
  /** A repeating event's next dates. Null for a one-off. */
  dates: BookableDate[] | null
}

/** What happens after booking a place. */
export interface RsvpAnswer {
  status: 'pending' | 'confirmed' | 'waitlist' | 'checkout'
  /** Where to send the visitor to pay, with `checkout`. */
  url?: string
}

/** What a confirm, cancel or pay link did. */
export interface RsvpLinkResult {
  status: RsvpStatus | 'closed' | 'no_pass' | 'checkout'
  title: string
  when: string
  path: string
  /** Where to send the visitor to pay, with `checkout`. */
  url?: string
  /** How to pay for a place being kept for them. */
  payUrl?: string
}

/** What cancelling now gives back. */
export interface CancelTerms {
  /** Null when nothing was paid, or it's too late. */
  refund: BookingMethod | null
  /** Paid, but past the point of getting anything back. */
  tooLate: boolean
  /** Last moment to cancel for a refund, when that's before the start. */
  deadline: string | null
}

/** What the cancel and pay pages show before anything is pressed (describeRsvpLink()). */
export interface RsvpLinkDetails extends RsvpLinkResult {
  seats: number
  terms: CancelTerms
  amount: number | null
  currency: string
  canPayByCard: boolean
  canUsePass: boolean
  holdExpiresAt: string | null
}

// ── Appointments ────────────────────────────────────────────────────────────

export type AppointmentStatus = 'draft' | 'pending' | 'held' | 'confirmed' | 'cancelled'

/** The service an Appointment block offers, as the booking form shows it. */
export interface PublicService {
  name: string
  duration: number
  durationText: string
  price: number | null
  currency: string
  cancelHours: number
  canPayByCard: boolean
}

/** One day's free start times. */
export interface AppointmentDay {
  date: string
  times: { start: string; time: string }[]
}

/** A page of free times for an Appointment block. */
export interface AppointmentFreeTimes {
  service: PublicService
  timeZone: string
  days: AppointmentDay[]
  /** The first day of the page before and after, or null at either end. */
  previous: string | null
  next: string | null
}

export interface BookingAnswer {
  status: 'pending' | 'confirmed' | 'checkout'
  url?: string
  id: string
}

/** What an appointment's confirm or cancel link did, or would do. */
export interface AppointmentLinkResult {
  status: AppointmentStatus | 'taken'
  service: string
  when: string
  path: string
  /** Cancel page: what cancelling now gives back. */
  refund?: boolean
  tooLate?: boolean
}

// ── A visitor's own list (/booking/my) ──────────────────────────────────────

export interface MyBookings {
  bookings: {
    id: string
    seats: number
    status: RsvpStatus
    title: string
    when: string
    location: string | null
    cancelUrl: string
    payUrl: string | null
  }[]
  appointments: {
    id: string
    service: string
    when: string
    status: AppointmentStatus
    cancelUrl: string
  }[]
  passes: {
    id: string
    name: string
    creditsLeft: number
    creditsTotal: number
    expiresAt: string | null
    status: 'active' | 'refunded'
  }[]
}
