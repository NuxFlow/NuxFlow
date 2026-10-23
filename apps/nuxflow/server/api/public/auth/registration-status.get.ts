import { isPublicRegistrationOpen } from '../../../utils/registration'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId
  if (!siteId) return { enabled: false }
  const enabled = await isPublicRegistrationOpen(event, siteId).catch(() => false)
  return { enabled }
})
