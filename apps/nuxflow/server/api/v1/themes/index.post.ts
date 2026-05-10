import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { putThemeCSS } from '../../../utils/cf-env'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

interface UploadBody {
  name: string
  version: string
  css: string
}

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readBody<UploadBody>(event)

  if (!body.name?.trim()) throw createError({ statusCode: 400, message: 'name is required' })
  if (!body.css?.trim()) throw createError({ statusCode: 400, message: 'css is required' })

  const id = ulid()
  const version = body.version?.trim() || '1.0.0'

  await putThemeCSS(event, siteId, id, body.css.trim())

  await db.insert(themes).values({
    id,
    siteId,
    packageName: `@dynamic/theme-${id}`,
    name: body.name.trim(),
    version,
    isActive: false,
    hasCss: true,
  })

  // Check if any other theme is active — if not, activate this one automatically
  const anyActive = await db.query.themes.findFirst({
    where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
    columns: { id: true },
  })

  if (!anyActive) {
    await db.update(themes)
      .set({ isActive: true })
      .where(and(eq(themes.id, id), eq(themes.siteId, siteId)))
  }

  return { success: true, id }
})
