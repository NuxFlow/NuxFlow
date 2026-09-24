import { isCrossOriginUnsafeRequest } from '../utils/csrf'

// Runs for every /api/** route, including /api/auth (Better Auth has its own origin
// check there too — this is just the same rule applied consistently). See csrf.ts for
// the reasoning; numbered to run early, before any handler can act on the request.
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return
  if (isCrossOriginUnsafeRequest(event)) {
    throw createError({ statusCode: 403, message: 'Cross-origin request blocked' })
  }
})
