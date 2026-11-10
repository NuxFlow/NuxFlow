import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { saveShopSettings, shopConfigSchema } from '../../../utils/shop'

const bodySchema = z.discriminatedUnion('action', [
  // The shop switch, and/or its settings.
  z.object({
    action: z.literal('settings'),
    enabled: z.boolean().optional(),
    config: shopConfigSchema.optional(),
  }),
])

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const body = await parseBody(event, bodySchema)
  const settings = await saveShopSettings(event, { enabled: body.enabled, config: body.config })
  await writeAuditLog(event, userId, { action: 'update', resource: 'shop_settings', after: { enabled: body.enabled, config: body.config } })
  return { settings }
})
