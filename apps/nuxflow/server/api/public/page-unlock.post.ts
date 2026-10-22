import { z } from 'zod'
import { useDb } from '../../utils/db'
import { rateLimit } from '../../utils/rate-limit'
import { findPublishedPage, parseLocalePath } from '../../utils/public-page'
import { PAGE_PASSWORD_MAX_LENGTH, unlockPage } from '../../utils/page-password'
import { requireSiteId } from '../../utils/site-context'

// The password form on a protected page (client galleries). `path` is the page's slug path
// as the public page API takes it ("smith-wedding", "es/smith-wedding"). A right password
// sets the page's unlock cookie (utils/page-password.ts); the page then reloads its data.
const bodySchema = z.object({
  path: z.string().trim().min(1).max(500),
  password: z.string().min(1).max(PAGE_PASSWORD_MAX_LENGTH),
})

export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)

  // Guessing is slowed per visitor across all of the site's pages, and per page. Each check
  // is an Argon2 verify (~150 ms of CPU), so this also caps what one visitor can spend.
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'page-unlock' })
  await rateLimit(event, { limit: 30, windowMs: 60 * 60_000, keyPrefix: 'page-unlock-hour' })

  const db = useDb(event)
  const slugPath = body.path.replace(/^\/+|\/+$/g, '')
  const { locale, slug } = await parseLocalePath(db, siteId, slugPath)
  const page = await findPublishedPage(db, siteId, slug, locale)
  if (!page || page.visibility !== 'password') throw notFound('Not found')

  const ok = await unlockPage(event, siteId, page, body.password)
  if (!ok) throw createError({ statusCode: 401, message: 'That password isn\'t right' })

  setHeader(event, 'Cache-Control', 'no-store')
  return { ok: true }
})
