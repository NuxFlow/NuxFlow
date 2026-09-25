import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { migrateInlineImagesBatch, migrateLocalMediaBatch, MigrationUnavailableError } from '../../../utils/media-migration'

const bodySchema = z.object({
  phase: z.enum(['media', 'inline']),
  cursor: z.string().max(200).nullish(),
})

// One small, bounded batch of the database → storage move (see media-migration.ts). The
// client calls this repeatedly, passing back `nextCursor`, until `done` is true for each
// phase.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const body = await parseBody(event, bodySchema)

  try {
    const result = body.phase === 'media'
      ? await migrateLocalMediaBatch(event, { cursor: body.cursor })
      : await migrateInlineImagesBatch(event, userId, { cursor: body.cursor })

    if (result.results.length > 0) {
      await writeAuditLog(event, userId, {
        action: 'migrate_storage',
        resource: 'media',
        after: {
          phase: body.phase,
          moved: result.results.filter(r => r.ok).map(r => r.id),
          failed: result.results.filter(r => !r.ok).map(r => ({ id: r.id, error: r.error })),
        },
      })
    }
    return result
  } catch (err) {
    if (err instanceof MigrationUnavailableError) throw conflict(err.message)
    throw err
  }
})
