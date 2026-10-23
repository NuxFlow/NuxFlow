import { resolveStringSetting } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const publicKey = await resolveStringSetting(event, 'push.vapid_public_key')
  return { publicKey: publicKey || null }
})
