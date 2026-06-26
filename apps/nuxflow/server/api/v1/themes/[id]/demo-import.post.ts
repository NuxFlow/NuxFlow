import { z } from 'zod'
import { requireRole } from '../../../../utils/permissions'
import { getThemeDemo } from '../../../../utils/cf-env'
import { applyBackup } from '../../../../utils/backup'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../utils/db'
import type { NuxFlowBackup } from '../../../../utils/backup'
import { writeAuditLog } from '../../../../utils/audit'

const bodySchema = z.object({
  what: z.array(z.enum(['content', 'taxonomies', 'menus', 'forms', 'settings'])).default(['content', 'taxonomies', 'menus', 'forms', 'settings']),
  conflictMode: z.enum(['skip', 'overwrite', 'archive']).default('archive'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const themeId = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, themeId), eq(themes.siteId, siteId)),
  })
  if (!theme) throw createError({ statusCode: 404, message: 'Theme not found' })

  const demoJson = await getThemeDemo(event, siteId, themeId)
  if (!demoJson) throw createError({ statusCode: 404, message: 'This theme has no demo content' })

  let backup: NuxFlowBackup
  try {
    backup = JSON.parse(demoJson) as NuxFlowBackup
  } catch {
    throw createError({ statusCode: 500, message: 'Demo content is corrupted' })
  }

  const result = await applyBackup(event, siteId, backup, {
    what: body.what,
    conflictMode: body.conflictMode,
  })

  // Automatically activate the theme since we are importing its content
  await db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  await db.update(themes).set({ isActive: true }).where(and(eq(themes.id, themeId), eq(themes.siteId, siteId)))

  await writeAuditLog(event, userId, { action: 'activate', resource: 'theme', resourceId: themeId })

  return { success: true, result }
})
