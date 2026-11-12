// What each site's usage is counted in (site_usage_daily): the metric names, shared by the
// server's counting (server/utils/usage.ts) and Super Admin → Usage. Import-free.

export const USAGE_EVENT_METRICS = [
  /** Public page requests that reached the Worker, cached or not. */
  'views',
  /** Pages built by the server (cache misses, admin pages) — the best stand-in for CPU time. */
  'renders',
  /** Requests to this site's /api routes. */
  'api',
  /** Calls to an AI model: text, image, transcription and speech — every call, whoever pays. */
  'ai_calls',
  /**
   * Weighted cost of the AI calls the platform pays for (Workers AI, or the deployment's
   * own env-var keys) — what the hosting plan's AI allowance limits. Calls made with the
   * site's own API key aren't included. See ai-allowance.ts.
   */
  'ai_credits',
  /**
   * Weighted cost of platform-paid AI that visitors, incoming mail and plugins set off
   * (listen, spam checks, inbox sorting, smart search, plugin AI) — kept out of `ai_credits` so the public
   * can't use up the team's allowance. Limited by the plan's "Visitor AI credits a month".
   */
  'ai_visitor_credits',
  /** Emails handed to a real provider (console-only "sends" aren't counted). */
  'emails',
  /** Emails received at the site's own addresses and accepted (inbox and post-by-email). */
  'inbound_emails',
  /** Requests and event hooks handled by the site's dynamic plugins (each runs a Dynamic Worker). */
  'plugin_calls',
  /**
   * Minutes of the platform's Cloudflare Stream video watched. Not counted per request —
   * written hourly from Stream's analytics by video-usage.ts, as each day's total.
   */
  'video_minutes_viewed',
] as const

export const USAGE_SNAPSHOT_METRICS = [
  /** Sum of media file sizes plus inbound email kept in R2. */
  'storage_bytes',
  /** Pages, posts and every other content item, any status. */
  'content_items',
  /** People with any role except member (viewer and above), not counting the operator's super admin. */
  'team_members',
  /** People with the member role. */
  'site_members',
  /** Installed dynamic plugins. */
  'plugins',
  /** Approximate bytes the site takes in the shared D1 database (see siteDatabaseBytes()). */
  'database_bytes',
] as const

export type UsageEventMetric = typeof USAGE_EVENT_METRICS[number]
export type UsageSnapshotMetric = typeof USAGE_SNAPSHOT_METRICS[number]
export type UsageMetric = UsageEventMetric | UsageSnapshotMetric
