import { isTenantHostInCentralMode } from '../../../utils/accounts-origin'
import { destroySiteAndParentSession } from '../../../utils/site-auth'

// Signs out everywhere: ends this site's session *and* the accounts-origin session it came
// from (which ends every other site session too — see utils/site-auth.ts). Ending only this
// site's session meant the next visit silently signed back in through the handoff. Only
// meaningful under central sign-in; a same-origin install signs out through Better Auth's
// own /api/auth/sign-out.
export default defineEventHandler(async (event) => {
  if (!isTenantHostInCentralMode(event)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  await destroySiteAndParentSession(event)
  return { success: true }
})
