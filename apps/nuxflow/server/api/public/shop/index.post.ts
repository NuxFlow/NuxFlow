import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { verifyTurnstile } from '../../../utils/turnstile'
import { getClientIp } from '../../../utils/client-ip'
import { requireShopOn } from '../../../utils/shop'
import { quoteBasket, startShopCheckout } from '../../../utils/shop-checkout'
import { MAX_BASKET_LINES, MAX_LINE_QUANTITY } from '../../../../shared/lib/shop'

const linesSchema = z.array(z.object({
  variantId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
})).max(MAX_BASKET_LINES)

const bodySchema = z.discriminatedUnion('action', [
  // The basket page: today's prices and stock for what's in the browser's basket.
  z.object({ action: z.literal('quote'), lines: linesSchema }),
  // Pay: re-priced here, stock taken while they're at Stripe.
  z.object({
    action: z.literal('checkout'),
    lines: linesSchema.min(1),
    email: z.string().trim().max(254).email().optional().or(z.literal('')),
    acceptedTerms: z.boolean().default(false),
    // This browser's last checkout, replaced by this one.
    previous: z.object({ orderId: z.string().min(1).max(64), token: z.string().max(128) }).optional(),
    // Click and collect: the time chosen from the basket page's choices.
    fulfilment: z.enum(['delivery', 'collect']).default('delivery'),
    collectAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/).optional(),
    turnstileToken: z.string().max(4096).optional(),
  }),
])

// The shop's basket and checkout, for visitors with no account.
export default defineEventHandler(async (event) => {
  await requireShopOn(event)
  const body = await parseBody(event, bodySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  if (body.action === 'quote') {
    await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'shop-quote' })
    return quoteBasket(event, body.lines)
  }
  // Each attempt keeps stock for half an hour, so these are what stop a bot emptying the shop.
  await rateLimit(event, { limit: 6, windowMs: 60_000, keyPrefix: 'shop-checkout' })
  if (!(await verifyTurnstile(body.turnstileToken ?? '', getClientIp(event) ?? undefined))) validationError('Spam check failed')
  return startShopCheckout(event, { lines: body.lines, email: body.email || undefined, acceptedTerms: body.acceptedTerms, previous: body.previous, fulfilment: body.fulfilment, collectAt: body.collectAt })
})
