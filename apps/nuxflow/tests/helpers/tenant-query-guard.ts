/**
 * Tenant query guard — fails the integration run when server code reads or changes a
 * site-scoped table without filtering by `site_id`.
 *
 * Every site's rows share one D1 database, so a query that forgets `site_id` can show or
 * change another tenant's data. This checks the SQL that actually runs, not how the code
 * is written: `getCurrentTestDb()` hands server code (anything that reached it through a
 * `server/` frame, i.e. the mocked `useDb()`) a Drizzle instance whose logger passes every
 * statement through `checkStatement()`. Test code's own seeding and assertions get the
 * plain instance and are never checked.
 *
 * The rule, per statement:
 *   - INSERTs are exempt (they write `site_id`, they don't filter on it).
 *   - Any other statement that names a table with a `site_id` column must compare
 *     `site_id` somewhere (`site_id = ?`, `site_id IN (...)`, a join on `a.site_id = b.site_id`).
 *   - Otherwise it must match an ALLOWLIST entry below, by the file that called `useDb()`
 *     and the tables involved.
 *
 * Known limits: one `site_id` comparison anywhere in the statement satisfies it, even when
 * several site-scoped tables are joined; queries built from a `db` the test passed in
 * directly, and raw `getD1()` SQL (whole-database export/stats, the migration runner — all
 * cross-site by design), aren't seen.
 */
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '@nuxflow/db/schema'

interface AllowlistEntry {
  /**
   * Path of the file that called useDb(), relative to apps/nuxflow (e.g.
   * 'server/scheduled/publish-scheduled.ts'). Omit only together with `match`, for a
   * shared helper whose one cross-site query is reached from many routes.
   */
  file?: string
  /** Narrows the entry to statements matching this pattern. */
  match?: RegExp
  /** Site-scoped tables this entry covers ('*' for all). A statement passes only if all its unfiltered site-scoped tables are listed. */
  tables: string[]
  /** Why this query is cross-site on purpose. Required, and must be understandable on its own. */
  reason: string
}

/**
 * Queries that are cross-site on purpose. Every new cross-site query needs an entry here
 * with a reason — if the reason is hard to write, the query probably needs a `site_id`
 * filter instead.
 */
export const ALLOWLIST: AllowlistEntry[] = [
  // ── Customers' own domains (hosting-domains.ts): a hostname belongs to one site at most ──
  {
    match: /from "site_domains" "siteDomains" where "siteDomains"\."hostname" = \?/,
    tables: ['site_domains'],
    reason: 'A domain can be connected to only one site: adding one, or giving a site a new main domain, checks it against every site.',
  },
  {
    file: 'server/utils/hosting-domains.ts',
    match: /from "site_domains" where \("site_domains"\."kind" = \? and "site_domains"\."cf_custom_hostname_id" is not null and "site_domains"\."live_notified_at" is null\)/,
    tables: ['site_domains'],
    reason: "checkPendingCustomDomains(): the hourly check of every site's domains that aren't live yet.",
  },
  // ── Accounts are global; these ask about a person across every site ──────────────
  {
    match: /from "user_site_roles" "userSiteRoles" where \("userSiteRoles"\."user_id" = \? and "userSiteRoles"\."role" = \?\)/,
    tables: ['user_site_roles'],
    reason: 'hasSuperAdminRole() (permissions.ts): a super_admin grant on any site makes someone a platform operator.',
  },
  {
    match: /from "user_site_roles" "userSiteRoles" where \("userSiteRoles"\."user_id" = \? and "userSiteRoles"\."role" not in/,
    tables: ['user_site_roles'],
    reason: 'isUnclaimedAccount() (user-provisioning.ts): an account is unclaimed only if it holds no staff role on any site.',
  },
  {
    file: 'server/utils/site-deletion.ts',
    tables: ['user_site_roles'],
    reason: "Finds which of a deleted site's users still belong to other sites, so their accounts are kept.",
  },
  {
    file: 'server/api/v1/account/data-export.get.ts',
    tables: ['api_keys', 'audit_logs', 'comments', 'content_items', 'form_submissions', 'media', 'subscriptions'],
    reason: "Data export (GDPR): the signed-in person's own data, from every site they use.",
  },
  {
    file: 'server/utils/account-data.ts',
    tables: ['api_keys', 'audit_logs', 'comments', 'content_items', 'form_submissions', 'media', 'subscriptions', 'user_site_roles'],
    reason: "Account deletion/export in a member pool (account-data.ts, reached from the control plane): the person's own data on every site in the pool.",
  },
  {
    file: 'server/utils/security-alerts.ts',
    tables: ['notifications'],
    reason: "New-device check: a person's earlier sign-in alerts are their device history, across every site.",
  },
  {
    file: 'server/utils/site-auth.ts',
    tables: ['site_auth_codes', 'site_sessions'],
    reason: 'Sign-in codes and site sessions are looked up by the hash of a secret only their holder has; the site is checked on the row found.',
  },
  {
    file: 'server/routes/_nuxflow/auth/callback.get.ts',
    tables: ['site_auth_codes'],
    reason: 'Sign-in callback: consumeSiteAuthCode() looks the code up by the hash of a secret only its holder has, then checks the site on the row found.',
  },
  {
    file: 'server/pool-host/control-plane-entrypoint.ts',
    tables: ['site_auth_codes'],
    reason: 'A member pool redeeming a sign-in code (pool-sign-in.ts): looked up by the hash of the secret, then the site and the calling pool are checked on the row found.',
  },
  {
    file: 'server/utils/pool-session.ts',
    tables: ['user_site_roles', 'site_invitations'],
    reason: "Member pool sign-in: a person who lost the platform's super-admin role loses it on every site in the pool, and once their address is verified every pending invitation they hold in the pool becomes a role (as the control plane does at password reset).",
  },
  {
    file: 'server/utils/inbound-email.ts',
    match: /from "site_settings" "siteSettings" where \("siteSettings"\."key" = \? and "siteSettings"\."value" = \?\)/,
    tables: ['site_settings'],
    reason: 'Inbound mail to the shared platform domain finds its site by the unique inbound handle.',
  },

  {
    file: 'server/api/v1/admin/usage/index.get.ts',
    tables: ['site_usage_daily'],
    reason: 'Super Admin → Usage: one month of usage for every site (requireSuperAdmin).',
  },
  {
    file: 'server/utils/usage-report.ts',
    tables: ['site_usage_daily'],
    reason: "Super Admin → Usage's monthly report (usage-report.ts), on the control plane or in a member pool asked by it: every site's month at once.",
  },

  // ── Scheduled jobs that run once for the whole installation ──────────────────────
  {
    file: 'server/scheduled/publish-scheduled.ts',
    tables: ['content_items', 'content_types'],
    reason: 'Every-minute job that publishes scheduled items on every site.',
  },
  {
    file: 'server/scheduled/prune-old-data.ts',
    tables: ['ai_generation_jobs', 'audit_logs', 'crawler_hits', 'email_log', 'email_messages', 'notifications', 'plugin_storage', 'site_auth_codes', 'site_invitations', 'site_sessions', 'site_usage_daily'],
    reason: 'Nightly retention clean-up for every site.',
  },
  {
    file: 'server/scheduled/reconcile-stuck-videos.ts',
    tables: ['video_assets'],
    reason: 'Marks video uploads stuck in processing as failed, on every site.',
  },
  {
    file: 'server/scheduled/stale-content-scan.ts',
    tables: ['content_items', 'notifications'],
    reason: 'Nightly scan for stale published content on every site.',
  },
  {
    file: 'server/scheduled/usage-snapshot.ts',
    tables: ['comments', 'content_items', 'dynamic_plugins', 'email_messages', 'form_submissions', 'media', 'plugin_storage', 'user_site_roles'],
    reason: "Nightly usage totals (and database size): one grouped query per table for every site's row at once.",
  },
  {
    file: 'server/utils/ai-allowance.ts',
    tables: ['site_usage_daily'],
    reason: "Platform-wide daily AI cap: today's AI credits summed across every customer site.",
  },
  {
    file: 'server/utils/site-directory.ts',
    tables: ['site_domains'],
    reason: "Router directory sync (control plane): an address any of this control plane's own sites uses must never be routed to a pool.",
  },
  {
    file: 'server/pool-host/entrypoint.ts',
    tables: ['site_domains'],
    reason: "A member pool's private admin RPC lists every site in the pool, with its extra addresses, for its control plane.",
  },
  {
    file: 'server/api/v1/admin/platform/index.get.ts',
    tables: ['site_usage_daily'],
    reason: "Super Admin → Platform shows today's AI credits across every customer site (requireSuperAdmin).",
  },
  {
    file: 'server/scheduled/plan-usage-alerts.ts',
    tables: ['site_usage_daily'],
    reason: "Hourly hosting-plan check: this month's totals for every site at once, compared with each site's plan.",
  },
  {
    file: 'server/scheduled/demo-reset.ts',
    tables: ['*'],
    reason: 'Wipes and reseeds the whole database — only ever runs on the public demo deployment (isDemoInstance()).',
  },
]

export const SITE_SCOPED_TABLES: ReadonlySet<string> = new Set(
  Object.values(schema)
    .filter((t): t is SQLiteTable => is(t, SQLiteTable))
    .filter(t => Object.values(getTableColumns(t)).some(c => c.name === 'site_id'))
    .map(t => getTableName(t)),
)

export interface Violation {
  caller: string
  tables: string[]
  sql: string
}

const violations: Violation[] = []
let checked = 0

/** How many server statements the guard has seen — lets its own test prove it's wired in. */
export function statementsChecked(): number {
  return checked
}

export function takeViolations(): Violation[] {
  return violations.splice(0)
}

const TABLE_REF = /\b(?:from|join|update|into)\s+[`"]?(\w+)[`"]?/gi
// `site_id = ?`, `"t"."site_id" in (...)`, `site_id is ...`, or `... = "t"."site_id"`.
const SITE_FILTER = /site_id[`"]?\s*(?:=|\bin\b|\bis\b)|=\s*(?:[`"]?\w+[`"]?\.)?[`"]?site_id\b/i

export function referencedSiteTables(sql: string): string[] {
  const found = new Set<string>()
  for (const m of sql.matchAll(TABLE_REF)) {
    const name = m[1]!.toLowerCase()
    if (SITE_SCOPED_TABLES.has(name)) found.add(name)
  }
  return [...found]
}

/** Returns the unfiltered site-scoped tables in `sql` that no allowlist entry covers, or [] if it's fine. */
export function checkStatement(sql: string, caller: string): string[] {
  const trimmed = sql.trimStart().toLowerCase()
  if (trimmed.startsWith('insert') || trimmed.startsWith('pragma') || trimmed.startsWith('create')) return []
  if (SITE_FILTER.test(sql)) return []
  const tables = referencedSiteTables(sql)
  if (tables.length === 0) return []
  const callerFile = caller.replace(/:\d+(?::\d+)?$/, '')
  const uncovered = tables.filter(t => !ALLOWLIST.some(e =>
    (e.file === undefined || e.file === callerFile)
    && (e.match === undefined || e.match.test(sql))
    && (e.tables.includes('*') || e.tables.includes(t))))
  return uncovered
}

export function recordStatement(sql: string, caller: string): void {
  checked++
  const tables = checkStatement(sql, caller)
  if (tables.length) violations.push({ caller, tables, sql })
}

const SERVER_FRAME = /[\\/]apps[\\/]nuxflow[\\/](server[\\/][^:)]+):(\d+)/

/**
 * The `server/...:line` frame that asked for the database, or null when the caller is
 * test code. Called synchronously from getCurrentTestDb(), while the stack still shows it.
 */
export function serverCaller(): string | null {
  const prev = Error.stackTraceLimit
  Error.stackTraceLimit = 30
  const stack = new Error('tenant-query-guard caller').stack ?? ''
  Error.stackTraceLimit = prev
  for (const line of stack.split('\n')) {
    const m = SERVER_FRAME.exec(line)
    if (m) return `${m[1]!.replace(/\\/g, '/')}:${m[2]}`
  }
  return null
}

export function formatViolations(all: Violation[]): string {
  const list = [...new Map(all.map(v => [`${v.caller} ${v.sql}`, v])).values()]
  const lines = list.map(v =>
    `  • ${v.caller} — no site_id filter on ${v.tables.join(', ')}\n      ${v.sql.slice(0, 300)}`,
  )
  return [
    `Tenant query guard: ${list.length} statement(s) touch a site-scoped table without filtering by site_id.`,
    'Add a site_id condition, or — if the query is cross-site on purpose — an ALLOWLIST entry with a reason',
    'in tests/helpers/tenant-query-guard.ts.',
    ...lines,
  ].join('\n')
}
