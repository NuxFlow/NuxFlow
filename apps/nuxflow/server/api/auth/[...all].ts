import { toWebRequest } from 'h3'

// Delegates to the shared Better Auth instance from server/utils/better-auth.ts.
// server/middleware/04.auth-override.ts provides an additional guarantee that
// runs before route resolution.
export default defineEventHandler(async (event) => {
  const auth = await getOrCreateBetterAuth(event)
  return auth.handler(toWebRequest(event))
})
