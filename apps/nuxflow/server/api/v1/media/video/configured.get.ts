import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'author')

  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

  return { configured: Boolean(accountId && streamToken) }
})
