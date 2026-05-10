import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
    columns: { id: true, packageName: true },
  })
  if (!theme) throw createError({ statusCode: 404, message: 'Theme not found' })

  const config = useRuntimeConfig()
  const token = Buffer.from(`${id}:${Date.now()}`).toString('base64url')
  const previewUrl = `${config.public.siteUrl}/?__theme_preview=${token}&__theme_id=${id}`

  return { previewUrl, token }
})
