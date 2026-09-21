import { describe, it, expect } from 'vitest'
import { GDPR_REDACTION_TARGETS, GDPR_REDACTION_EXEMPT, findUserSetNullFkColumns } from '@nuxflow/db/queries'

/**
 * Guard rail for a gap flagged in a full-codebase audit: account deletion's Article 17
 * (right to erasure) redaction used to hand-pick two tables (comments, formSubmissions)
 * with no mechanism forcing a future table with the same shape — a nullable, ON DELETE
 * SET NULL FK to users.id alongside free-text content — to be noticed and triaged.
 *
 * This scans the live schema for every column with that exact FK shape and asserts each
 * one is accounted for in either GDPR_REDACTION_TARGETS (gets redacted) or
 * GDPR_REDACTION_EXEMPT (deliberately left as attribution-only nulling, with a reason) —
 * see packages/db/src/queries/gdpr.ts for both. A newly added table falling into neither
 * list fails this test instead of silently shipping a personal-data leak past erasure.
 */
describe('GDPR redaction registry — schema coverage guard rail', () => {
  it('every ON DELETE SET NULL FK to users.id is either redacted or explicitly exempt', () => {
    const found = findUserSetNullFkColumns()
    const targetKeys = new Set(GDPR_REDACTION_TARGETS.map(t => t.key))
    const exemptKeys = new Set(Object.keys(GDPR_REDACTION_EXEMPT))

    const unaccounted = found.filter(key => !targetKeys.has(key) && !exemptKeys.has(key))

    expect(
      unaccounted,
      `These columns have an ON DELETE SET NULL FK to users.id but aren't in GDPR_REDACTION_TARGETS or GDPR_REDACTION_EXEMPT (packages/db/src/queries/gdpr.ts) — decide whether account deletion needs to redact their content for Article 17, then add an entry: ${unaccounted.join(', ')}`,
    ).toEqual([])
  })

  it('every GDPR_REDACTION_TARGETS entry still matches a real column in the schema (no stale targets)', () => {
    const found = new Set(findUserSetNullFkColumns())
    for (const target of GDPR_REDACTION_TARGETS) {
      expect(found.has(target.key), `GDPR_REDACTION_TARGETS lists '${target.key}' but no such ON DELETE SET NULL FK to users.id exists in the schema anymore — remove the stale entry.`).toBe(true)
    }
  })

  it('every GDPR_REDACTION_EXEMPT entry still matches a real column in the schema (no stale exemptions)', () => {
    const found = new Set(findUserSetNullFkColumns())
    for (const key of Object.keys(GDPR_REDACTION_EXEMPT)) {
      expect(found.has(key), `GDPR_REDACTION_EXEMPT lists '${key}' but no such ON DELETE SET NULL FK to users.id exists in the schema anymore — remove the stale exemption.`).toBe(true)
    }
  })
})
