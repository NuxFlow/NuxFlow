import { isTenantHostInCentralMode } from '../../../utils/accounts-origin'
import { destroySiteSession } from '../../../utils/site-auth'

// Signs out of this site only (its site session — see utils/site-auth.ts). Signing out of
// every site at once happens on the accounts origin, whose session is the parent of every
// site session. Only meaningful under central sign-in; a same-origin install signs out
// through Better Auth's own /api/auth/sign-out.
export default defineEventHandler(async (event) => {
  if (!isTenantHostInCentralMode(event)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  await destroySiteSession(event)
  return { success: true }
})
