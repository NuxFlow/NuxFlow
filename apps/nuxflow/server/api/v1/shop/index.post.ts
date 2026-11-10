import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { saveShopSettings, shopConfigSchema } from '../../../utils/shop'
import { removeVariantFile, uploadVariantFile } from '../../../utils/shop-downloads'

const bodySchema = z.discriminatedUnion('action', [
  // The shop switch, and/or its settings (admins only).
  z.object({
    action: z.literal('settings'),
    enabled: z.boolean().optional(),
    config: shopConfigSchema.partial().optional(),
  }),
  // Takes a download variant's file away (editors, like the rest of a product).
  z.object({ action: z.literal('remove-file'), variantId: z.string().min(1).max(64) }),
])

// Admin → Shop, plus a download variant's file. The file comes as multipart form data
// (`variantId` and `file`); everything else is JSON.
export default defineEventHandler(async (event) => {
  if (getHeader(event, 'content-type')?.startsWith('multipart/form-data')) {
    const { userId } = await requireRole(event, 'editor')
    const parts = await readMultipartFormData(event) ?? []
    const variantId = parts.find(p => p.name === 'variantId')?.data.toString()
    const file = parts.find(p => p.name === 'file' && p.filename)
    if (!variantId || !file) validationError('Choose a file to upload.')
    const stored = await uploadVariantFile(event, variantId, { name: file.filename!, type: file.type, data: new Uint8Array(file.data) })
    await writeAuditLog(event, userId, { action: 'update', resource: 'product_variant', resourceId: variantId, after: stored })
    return stored
  }

  const body = await parseBody(event, bodySchema)
  if (body.action === 'remove-file') {
    const { userId } = await requireRole(event, 'editor')
    await removeVariantFile(event, body.variantId)
    await writeAuditLog(event, userId, { action: 'update', resource: 'product_variant', resourceId: body.variantId, after: { fileName: null } })
    return { removed: true }
  }

  const { userId } = await requireRole(event, 'admin')
  const settings = await saveShopSettings(event, { enabled: body.enabled, config: body.config })
  await writeAuditLog(event, userId, { action: 'update', resource: 'shop_settings', after: { enabled: body.enabled, config: body.config } })
  return { settings }
})
