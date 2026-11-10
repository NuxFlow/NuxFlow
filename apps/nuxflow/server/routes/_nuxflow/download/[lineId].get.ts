import { z } from 'zod'
import { serveDownload } from '../../../utils/shop-downloads'

const querySchema = z.object({ token: z.string().max(128) })

// A digital product's file, from the signed link in the order email and on the order page.
// Not under /api: it's a link people open, never fetched by the app.
export default defineEventHandler(async (event) => {
  const { token } = parseQuery(event, querySchema)
  return serveDownload(event, getRouterParam(event, 'lineId')!, token)
})
