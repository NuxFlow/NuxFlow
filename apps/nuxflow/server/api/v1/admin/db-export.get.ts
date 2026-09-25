import { sendStream } from 'h3'
import { requireSuperAdmin } from '../../../utils/permissions'
import { prepareD1Dump, streamD1TableData } from '../../../utils/d1-export'
import { writeAuditLog } from '../../../utils/audit'
import { notifySiteRole } from '../../../utils/notify'

// Whole-D1-instance raw SQL export — every site's data in one file. Gated on
// requireSuperAdmin (cross-site), not the site-scoped requireRole() the per-site
// /api/v1/backup route uses, since a regular site admin has no business downloading
// every other tenant's rows. See server/utils/d1-export.ts for how the dump itself
// is built and why (wrangler d1 export is CLI-only, unreachable from a live Worker).
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)

  // Schema introspection is small and bounded regardless of database size, so it's
  // resolved *before* any bytes reach the client — a failure here still becomes a clean,
  // labeled 500 the normal way (safe to surface the real D1 error: super-admin-only).
  // Row data is not bounded like that for a real deployment, so it's streamed straight to
  // the response as it's fetched instead — see d1-export.ts's module doc for why: an
  // earlier version buffered the whole dump in memory before returning it and hit
  // "Worker exceeded memory limit" (this Worker's own isolate cap, separate from D1's)
  // on a real database once total dump size got large, even after D1's own per-query
  // isolate-memory limit was already fixed.
  let prep: Awaited<ReturnType<typeof prepareD1Dump>>
  try {
    prep = await prepareD1Dump(event)
  } catch (err) {
    console.error('[db-export] D1 export preparation failed:', err)
    const message = err instanceof Error ? err.message : String(err)
    throw createError({ statusCode: 500, message: `D1 export failed: ${message}` })
  }

  const filename = `nuxflow-d1-export-${new Date().toISOString().slice(0, 10)}.sql`
  setHeader(event, 'Content-Type', 'application/sql; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)

  // Same TransformStream + sendStream() pattern already used by
  // server/api/v1/import/wordpress.post.ts's import-progress stream — bytes reach the
  // client as they're produced instead of accumulating here.
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const enc = new TextEncoder()
  const write = (chunk: string) => writer.write(enc.encode(chunk))

  void (async () => {
    try {
      await write(prep.headerText)
      const { tableCount, rowCount } = await streamD1TableData(event, prep.dataTables, write)
      await write(`\n\n-- Exported ${tableCount} table${tableCount === 1 ? '' : 's'}, ${rowCount} row${rowCount === 1 ? '' : 's'}\n`)

      // Not site-scoped (auditLogs.siteId is NOT NULL and this action spans every
      // site), so this lands against whichever site's domain the super admin happened
      // to be on — matches how other cross-site super-admin actions in this codebase
      // already log.
      await writeAuditLog(event, userId, {
        action: 'export',
        resource: 'd1_database',
        resourceId: 'all-sites',
        after: { tableCount, rowCount },
      })
      // A whole-platform export contains every tenant's data — tell the other super admins.
      await notifySiteRole(event, {
        siteId: event.context.siteId as string,
        minRole: 'super_admin',
        excludeUserId: userId,
        type: 'system.db_export',
        title: 'A full database export was downloaded',
        body: `A super admin downloaded a complete export of every site's data (${tableCount} tables, ${rowCount} rows).`,
        sendEmailNotification: true,
      }).catch(err => console.error('[db-export] Notification failed:', err))
    } catch (err) {
      console.error('[db-export] D1 export failed mid-stream:', err)
      const message = err instanceof Error ? err.message : String(err)
      // The response's 200 status and attachment headers are already on the wire by
      // this point, so a mid-stream failure can no longer become a clean HTTP error —
      // surfaced as a trailing comment with a deliberately-missing completion summary
      // instead, so a truncated .sql file reads as an obviously failed/incomplete export
      // rather than silently passing as a complete one if someone tries to restore it.
      await write(`\n\n-- EXPORT FAILED: ${message}\n-- This file is INCOMPLETE — do not restore it. Re-run the export, or use \`wrangler d1 export\` from the CLI instead.\n`).catch(() => {})
      await writeAuditLog(event, userId, {
        action: 'export',
        resource: 'd1_database',
        resourceId: 'all-sites',
        after: { failed: true, message },
      }).catch(() => {})
    } finally {
      await writer.close().catch(() => {})
    }
  })()

  return sendStream(event, readable)
})
