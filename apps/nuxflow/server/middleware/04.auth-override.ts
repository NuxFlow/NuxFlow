import { toWebRequest } from 'h3'

// Intercepts all /api/auth/** requests BEFORE route handlers run.
// This guarantees our Better Auth instance (with allowedHosts for multi-domain
// OAuth) handles auth regardless of module-route registration order in Nitro.
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/auth')) return
  const auth = await getOrCreateBetterAuth(event)
  return auth.handler(toWebRequest(event))
})
