import { sweepShopHolds } from '../scheduled/shop-holds'

export default defineTask({
  meta: {
    name: 'shop-holds',
    description: 'Give back the stock kept for shop checkouts that were never paid',
  },
  async run() {
    // See publish-scheduled.ts for why this try/catch exists.
    try {
      return { result: await sweepShopHolds() }
    }
    catch (err) {
      console.error('[shop-holds] task failed:', err)
      throw err
    }
  },
})
