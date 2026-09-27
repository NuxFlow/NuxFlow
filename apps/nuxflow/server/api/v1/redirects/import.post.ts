import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { parseRedirectCsv, redirectRuleSchema, saveRedirect } from '../../../utils/redirects'

const MAX_RULES = 2000

const bodySchema = z.object({
  csv: z.string().max(1_000_000),
  // Replace rules whose source path already exists; otherwise existing rules are kept.
  overwrite: z.boolean().default(false),
})

/**
 * Bulk import (e.g. when migrating from another CMS): `from,to[,status]` per line.
 * Invalid lines are reported back by line number rather than failing the whole import.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const { csv, overwrite } = await parseBody(event, bodySchema)

  const { rules, lineErrors } = parseRedirectCsv(csv)
  if (rules.length > MAX_RULES) validationError(`Too many rules (${rules.length}) — import at most ${MAX_RULES} at a time`)

  const errors = [...lineErrors]
  let createdCount = 0
  let updated = 0
  let skipped = 0

  for (const { line, rule } of rules) {
    const parsed = redirectRuleSchema.safeParse(rule)
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues.map(e => e.message).join('; ') })
      continue
    }
    const saved = await saveRedirect(db, siteId, parsed.data, { overwrite })
    if (saved.action === 'created') createdCount++
    else if (saved.action === 'updated') updated++
    else skipped++
  }

  if (createdCount + updated > 0) {
    await writeAuditLog(event, userId, {
      action: 'create',
      resource: 'redirect',
      after: { imported: createdCount, updated },
    })
  }

  errors.sort((a, b) => a.line - b.line)
  return { created: createdCount, updated, skipped, errors }
})
