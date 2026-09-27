import { useDb } from '../utils/db'
import { getSeoSettings } from '../utils/seo'

/**
 * IndexNow key verification file (the `keyLocation` submitted by utils/indexnow.ts):
 * search engines fetch it to confirm a submission really came from this host. Serves the
 * site's key only while IndexNow is enabled for it. The key is not a secret — proving
 * control of the host is exactly what publishing it here does.
 */
export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const seo = await getSeoSettings(useDb(event), siteId)
  if (!seo.indexnowEnabled || !seo.indexnowKey) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  setHeader(event, 'Content-Type', 'text/plain; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return seo.indexnowKey
})
