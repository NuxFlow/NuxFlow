// What the shop's public API sends (server/utils/shop-checkout.ts): the basket's prices
// (POST /api/public/shop `quote`) and a customer's own order (GET /api/public/shop?order=,
// behind the order link's signature). Then what staff see: Admin → Orders
// (server/utils/order-admin.ts) and Admin → Shop. Import-free apart from other shared/lib types.
import type { CollectionDay } from './shop-collection'
import type { ShopSettings } from './shop'

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

// ── Staff: Admin → Orders and Admin → Shop

/** What an order line is for. */
export type OrderLineKind = 'product' | 'booking' | 'pass' | 'tier' | 'appointment'

/** An order as staff see it. Amounts are whole minor units. */
export interface AdminOrder {
  id: string
  number: number
  status: OrderStatus
  email: string
  name: string
  currency: string
  subtotalMinor: number
  discountMinor: number
  shippingMinor: number
  taxMinor: number
  totalMinor: number
  refundedMinor: number
  /** Click and collect: `collect`, with the chosen time (site time) in `collectAt`. */
  fulfilment: 'delivery' | 'collect'
  collectAt: string | null
  stripePaymentIntentId: string | null
  paidAt: string | null
  createdAt: string
  shippingAddress: ShippingAddress | null
}

/** One row of the orders list, with a summary of what was bought. */
export interface AdminOrderSummary extends AdminOrder {
  lines: { kind: OrderLineKind; name: string; quantity: number }[]
}

/** GET /api/v1/orders: one page of orders. */
export interface AdminOrderList {
  orders: AdminOrderSummary[]
  total: number
  page: number
  perPage: number
}

export interface AdminOrderLine {
  id: string
  kind: OrderLineKind
  name: string
  description: string | null
  quantity: number
  unitMinor: number
  totalMinor: number
  isDigital: boolean
  /** How many times its file has been downloaded. */
  downloads: number
}

export interface AdminOrderRefund {
  id: string
  amountMinor: number
  reason: string | null
  createdBy: string | null
  createdAt: string
}

/** GET /api/v1/orders?id=: one order with its lines and refunds. */
export interface AdminOrderDetail {
  order: AdminOrder
  lines: AdminOrderLine[]
  refunds: AdminOrderRefund[]
  /** Refunded in Stripe's dashboard, so there's no refund row of ours for it. */
  refundedElsewhereMinor: number
  /** What a full refund would end (a booking, a pass…), for the warning beside the button. */
  refundNotes: string[]
}

/** GET /api/v1/shop: Admin → Shop (editors read it too, for the shop's currency). */
export interface ShopStatus {
  settings: ShopSettings
  /** The site's hosting plan includes the shop. */
  inPlan: boolean
  /** Stripe and its webhook are set up. */
  paymentsReady: boolean
  productCount: number
  hasProductType: boolean
}
