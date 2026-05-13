import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { applyBackup } from '../../utils/backup'
import type { NuxFlowBackup, RestoreOptions } from '../../utils/backup'

const querySchema = z.object({
  what: z.string().default('content,taxonomies,menus,forms,settings'),
  conflictMode: z.enum(['skip', 'overwrite']).default('skip'),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const query = await getValidatedQuery(event, querySchema.parse)

  const what = query.what.split(',').filter(
    (w): w is RestoreOptions['what'][number] =>
      ['content', 'taxonomies', 'menus', 'forms', 'settings'].includes(w),
  )

  const formData = await readMultipartFormData(event)
  const file = formData?.find(f => f.name === 'file')
  if (!file) throw createError({ statusCode: 400, message: 'No file uploaded' })

  let backup: NuxFlowBackup
  try {
    backup = JSON.parse(new TextDecoder().decode(file.data)) as NuxFlowBackup
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid backup file — expected JSON' })
  }

  if (backup.version !== '1') {
    throw createError({ statusCode: 400, message: `Unsupported backup version: ${backup.version}` })
  }

  const result = await applyBackup(event, siteId, backup, {
    what,
    conflictMode: query.conflictMode,
  })

  return { success: true, result }
})
