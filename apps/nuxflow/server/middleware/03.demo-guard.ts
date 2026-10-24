import { DEMO_MAX_BODY_BYTES, demoBlockReason, isDemoMode } from '../utils/demo-mode'

// The public demo's request guard (see utils/demo-mode.ts). Does nothing unless the Worker
// runs with NUXT_IS_DEMO = "true". Runs before 04.auth-override.ts so a blocked Better Auth
// action never reaches it, and before the page cache (07) so cached HITs are noindex too.
export default defineEventHandler((event) => {
  if (!isDemoMode(event)) return

  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')

  const pathname = getRequestURL(event).pathname
  const reason = demoBlockReason(event.method, pathname)
  if (reason) throw forbidden(reason)

  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > DEMO_MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, message: 'Uploads are limited to 2 MB in the live demo.' })
  }
})
