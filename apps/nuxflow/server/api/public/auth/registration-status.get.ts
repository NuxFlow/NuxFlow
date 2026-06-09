import { resolveSetting } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | undefined
  if (!siteId) return { enabled: false }
  const value = await resolveSetting(event, 'auth.allow_public_registration').catch(() => '')
  return { enabled: value === 'true' }
})
