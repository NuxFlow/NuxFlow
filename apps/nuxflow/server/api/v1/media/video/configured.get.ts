import { requireRole } from '../../../../utils/permissions'
import { resolveStringSetting } from '../../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'author')

  const accountId = await resolveStringSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveStringSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

  return { configured: Boolean(accountId && streamToken) }
})
