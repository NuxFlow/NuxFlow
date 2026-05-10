import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { putPluginServerCode, putPluginClientBundle } from '../../../utils/cf-env'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

interface InstallBody {
  id: string
  name: string
  version: string
  description?: string
  /** Base64-encoded self-contained ES module (exports default fetch handler). */
  serverModule?: string
  /** Base64-encoded ES module (exports `register(app: App): void`). */
  clientBundle?: string
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8')
}

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readBody<InstallBody>(event)

  if (!body.id || !body.name || !body.version) {
    throw createError({ statusCode: 400, message: 'id, name, and version are required' })
  }
  if (!body.serverModule && !body.clientBundle) {
    throw createError({ statusCode: 400, message: 'At least one of serverModule or clientBundle is required' })
  }

  const existing = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, body.id), eq(dynamicPlugins.siteId, siteId)),
  })
  if (existing) throw createError({ statusCode: 409, message: 'Plugin already installed' })

  const serverCode = body.serverModule ? decodeBase64(body.serverModule) : null
  const clientCode = body.clientBundle ? decodeBase64(body.clientBundle) : null

  if (serverCode) await putPluginServerCode(event, siteId, body.id, serverCode)
  if (clientCode) await putPluginClientBundle(event, siteId, body.id, clientCode)

  await db.insert(dynamicPlugins).values({
    id: body.id,
    siteId,
    name: body.name,
    version: body.version,
    description: body.description ?? '',
    isActive: false,
    hasServer: Boolean(serverCode),
    hasClient: Boolean(clientCode),
  })

  return { success: true }
})
