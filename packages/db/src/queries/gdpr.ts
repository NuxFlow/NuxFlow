import { eq, is } from 'drizzle-orm'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import type { BatchItem } from 'drizzle-orm/batch'
import * as schema from '../schema'
import { comments, formSubmissions, users } from '../schema'
import type { Db } from './types'

/**
 * Every table holding free-text/JSON content a person typed themselves, reachable via a
 * column with a real `ON DELETE SET NULL` FK to `users.id`. Account deletion's own
 * cascade already nulls out the *attribution* column (authorId/userId) via that FK, but
 * leaves the content itself fully intact — Article 17 (right to erasure) requires the
 * content gone, not just its attribution (see the full reasoning in the doc comment on
 * `apps/nuxflow/server/api/v1/account/index.delete.ts`, which builds its redaction batch
 * from this registry instead of hand-picking tables). `key` is `${tableName}.${columnName}`
 * (snake_case, matching the schema's own DB column names) — the same shape
 * `findUserSetNullFkColumns()` below produces from a live schema scan, so the two can be
 * diffed directly.
 */
export interface GdprRedactionTarget {
  key: string
  build(db: Db, userId: string): BatchItem<'sqlite'>
}

export const GDPR_REDACTION_TARGETS: GdprRedactionTarget[] = [
  {
    key: 'comments.author_id',
    build: (db, userId) => db.update(comments).set({ body: '[deleted]' }).where(eq(comments.authorId, userId)),
  },
  {
    key: 'form_submissions.user_id',
    build: (db, userId) => db.update(formSubmissions).set({ data: { redacted: true, redactedAt: new Date().toISOString() } }).where(eq(formSubmissions.userId, userId)),
  },
]

/**
 * Tables with the same `ON DELETE SET NULL → users.id` FK shape as the redaction targets
 * above, deliberately left OUT of the redaction batch — each entry records the reason a
 * future reviewer needs to re-evaluate that decision, not just trust it silently.
 * `tests/unit/gdpr-redaction.test.ts` asserts every column `findUserSetNullFkColumns()`
 * finds is accounted for in either this map or GDPR_REDACTION_TARGETS above, so a newly
 * added table with this FK shape can't silently fall through Article 17 with nobody
 * having actually decided whether it needs redacting.
 */
export const GDPR_REDACTION_EXEMPT: Record<string, string> = {
  'content_items.author_id': 'Site content, not personal data about the author — the body is the site\'s, not the person\'s (matches data-export.get.ts\'s own exclusion of full content bodies from the personal-data export).',
  'content_revisions.author_id': 'Same reasoning as content_items.author_id — historical site content, not the person\'s personal data.',
  'media.uploaded_by': 'The uploaded file is the site\'s media library content, not personal data about the uploader — uploadedBy is attribution only, already nulled by the FK\'s own cascade.',
  'video_assets.uploaded_by': 'Same reasoning as media.uploaded_by.',
  'email_messages.sent_by_user_id': 'An inbox reply is the site\'s correspondence with a customer, sent on the site\'s behalf from a site address — not personal data about the staff member who typed it. The FK\'s own SET NULL already removes the attribution.',
  'audit_logs.user_id': 'A compliance/security record — must NEVER be altered by the subject of the action it records, redacted or otherwise. Attribution nulling via the FK\'s own cascade is already the correct and sufficient outcome here.',
}

export function buildGdprRedactionStatements(db: Db, userId: string): BatchItem<'sqlite'>[] {
  return GDPR_REDACTION_TARGETS.map(target => target.build(db, userId))
}

/**
 * Scans every table in the schema for a column with a real `ON DELETE SET NULL` FK to
 * `users.id`, keyed the same way as GDPR_REDACTION_TARGETS/GDPR_REDACTION_EXEMPT above.
 * Exported (not test-local) so the schema-introspection logic — which a future schema
 * change could easily invalidate without anyone noticing — lives next to the registry it
 * validates, not duplicated inside the test file.
 */
export function findUserSetNullFkColumns(): string[] {
  const keys: string[] = []
  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) continue
    const config = getTableConfig(value)
    for (const fk of config.foreignKeys) {
      if (fk.onDelete !== 'set null') continue
      const ref = fk.reference()
      if (ref.foreignTable !== users) continue
      for (const col of ref.columns) {
        keys.push(`${config.name}.${col.name}`)
      }
    }
  }
  return keys
}
