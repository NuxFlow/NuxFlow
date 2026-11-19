import type { AuditIssueCode, AuditItem } from '#shared/lib/seo-types'

// Which SEO audit problems "Suggest fixes with AI" (AdminSeoAiFixModal) can help with.
export const SEO_TITLE_ISSUES: ReadonlySet<AuditIssueCode> = new Set(['title_too_long', 'duplicate_title'])
export const SEO_DESCRIPTION_ISSUES: ReadonlySet<AuditIssueCode> = new Set(['missing_description', 'description_too_short', 'description_too_long', 'no_custom_description', 'duplicate_description'])

/** The audited pages with a title or description problem. */
export function seoFixableItems(items: AuditItem[]): AuditItem[] {
  return items.filter(i => i.issues.some(x => SEO_TITLE_ISSUES.has(x.code) || SEO_DESCRIPTION_ISSUES.has(x.code)))
}
