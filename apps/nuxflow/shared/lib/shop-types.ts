// What the shop's public API sends (server/utils/shop-checkout.ts): the basket's prices
// (POST /api/public/shop `quote`) and a customer's own order (GET /api/public/shop?order=,
// behind the order link's signature). Import-free apart from other shared/lib types.
import type { CollectionDay } from './shop-collection'

/** One basket line, priced from the database (never from what the browser says). */
export interface PricedLine {
  variantId: string
  productId: string
  title: string
  label: string
  path: string
  image: string | null
  unitMinor: number
  quantity: number
  isDigital: boolean
  /** Null: not tracked. */
  stock: number | null
  /** Why it can't be bought as asked, in words fit to show; null when it can. */
  problem: string | null
}

export interface BasketQuote {
  lines: (Omit<PricedLine, 'stock'> & { unit: string; total: string })[]
  subtotal: string
  shipping: string | null
  subtotalMinor: number
  shippingMinor: number
  currency: string
  pricesIncludeTax: boolean
  /** Tax is added at checkout (Stripe Tax on, prices without it). */
  taxAtCheckout: boolean
  /** Something has to be posted and the shop neither posts it nor offers collection. */
  cannotShip: boolean
  /** The shop posts somewhere (delivery can be chosen for posted goods). */
  canDeliver: boolean
  /** Click and collect, when it's on and something in the basket isn't a download. */
  collection: { label: string; instructions: string; days: CollectionDay[] } | null
  /** The returns-policy page to agree to, when the shop has one. */
  returnsPath: string | null
  paymentsReady: boolean
}

export type OrderStatus = 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'expired' | 'cancelled'

export interface ShippingAddress {
  name?: string | null
  phone?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
}

/** A download's link on a paid order: how many goes are left, and until when. */
export interface DownloadState {
  left: number
  expiresAt: string
  available: boolean
}

/** A customer's own order, as /checkout/order and /checkout/thanks show it. Amounts are formatted. */
export interface CustomerOrder {
  number: number
  status: OrderStatus
  email: string
  paidAt: string | null
  createdAt: string
  subtotal: string
  shipping: string | null
  tax: string | null
  total: string
  refunded: string | null
  shippingAddress: ShippingAddress | null
  /** Click and collect: when, what the shop calls it, and where/how. */
  collection: { when: string; label: string; instructions: string } | null
  lines: {
    id: string
    name: string
    description: string | null
    quantity: number
    total: string
    download: (DownloadState & { url: string }) | null
  }[]
}
