import { useDb } from '../utils/db'
import { releaseLapsedHolds } from '../utils/shop-checkout'

/**
 * Every minute: stock kept for shop checkouts nobody finished goes back on sale. The expiry
 * webhook normally does this as the checkout closes; this catches the ones whose webhook
 * never came, or came before the hold ran out. Uses the partial index
 * idx_orders_pending_hold, so a site with no shop costs one empty index lookup.
 */
export async function sweepShopHolds(now = new Date()): Promise<{ released: number }> {
  return { released: await releaseLapsedHolds(useDb(), now) }
}
