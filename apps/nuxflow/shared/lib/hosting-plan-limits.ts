/**
 * The limits a hosting plan can set — shared by the server (enforcement, usage) and the
 * admin UI (plan editor, usage card), so names and units can't drift apart. Each maps to a
 * nullable `max_*` column on `hosting_plans`; null means unlimited.
 *
 * Hard limits refuse the action that would go over. Soft limits are only counted: the
 * platform operator is notified at 80% and 100%, and nothing is ever blocked — a public
 * site is never broken over traffic.
 */
export const PLAN_LIMITS = [
  { key: 'storage', column: 'maxStorageBytes', kind: 'hard', monthly: false, unit: 'bytes', label: 'Storage', hint: 'Total size of the media library.' },
  { key: 'content', column: 'maxContentItems', kind: 'hard', monthly: false, unit: 'count', label: 'Pages and posts', hint: 'Every content item, in any status.' },
  { key: 'team', column: 'maxTeamMembers', kind: 'hard', monthly: false, unit: 'count', label: 'Team members', hint: 'People with a viewer, author, editor or admin role, including pending invitations.' },
  { key: 'members', column: 'maxSiteMembers', kind: 'hard', monthly: false, unit: 'count', label: 'Site members', hint: 'Visitors who signed up or joined as members.' },
  { key: 'plugins', column: 'maxPlugins', kind: 'hard', monthly: false, unit: 'count', label: 'Plugins', hint: '0 means no plugins.' },
  { key: 'domains', column: 'maxCustomDomains', kind: 'hard', monthly: false, unit: 'count', label: 'Own domains', hint: 'Domains the customer connects themselves, like cafe.co.uk. 0 means not included.' },
  // Only videos kept in your Cloudflare Stream account count — a customer on their own Stream account is never limited.
  { key: 'video', column: 'maxVideoMinutes', kind: 'hard', monthly: false, unit: 'count', label: 'Video minutes stored', hint: 'Videos uploaded to your Cloudflare Stream account, in minutes. Stream bills $5 a month per 1,000 minutes stored, plus $1 per 1,000 minutes watched. 0 means no video uploads (YouTube and Vimeo links always work). Customers who add their own Stream account in Settings → Media aren’t counted.' },
  { key: 'video_watch', column: 'maxVideoMinutesWatchedPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'Video minutes watched a month', hint: 'Minutes of the customer’s uploaded videos that visitors watch, counted hourly from Stream’s analytics (needs the analytics API token on Super Admin → Platform). At the limit their uploaded videos stop playing until the 1st; YouTube and Vimeo videos keep working. Stream bills $1 per 1,000 minutes watched. 0 means no watching, so set this whenever you set video minutes stored.' },
  // The column is still named for calls; since AI credits replaced calls it holds credits.
  { key: 'ai', column: 'maxAiCallsPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'AI credits a month', hint: 'AI you pay for (Workers AI). A writing-tool use is usually 1–3 credits, an AI-generated page 20–60, an image 10. AI on the customer’s own API key is never counted.' },
  { key: 'visitor_ai', column: 'maxVisitorAiCreditsPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'Visitor AI credits a month', hint: 'AI that visitors, incoming mail and plugins set off: Listen to this article, spam checks on comments and forms, inbox sorting, smart search and plugin AI. Kept apart from the team’s allowance so the public can’t use it up. When it runs out these features pause until the 1st; nothing else stops.' },
  { key: 'emails', column: 'maxEmailsPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'Emails a month', hint: 'Per recipient. Sign-in, password and security emails are never blocked.' },
  { key: 'inbound', column: 'maxInboundEmailsPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'Emails received a month', hint: 'Mail arriving at the site’s own addresses (inbox and post-by-email). Over the limit, new mail is turned away until the 1st. Attachments also count towards storage.' },
  { key: 'views', column: 'maxViewsPerMonth', kind: 'soft', monthly: true, unit: 'count', label: 'Page views a month', hint: 'Soft: you get a notice at 80% and 100%; nothing is blocked.' },
  { key: 'renders', column: 'maxRendersPerMonth', kind: 'soft', monthly: true, unit: 'count', label: 'Server renders a month', hint: 'Soft: you get a notice at 80% and 100%; nothing is blocked.' },
  { key: 'plugin_calls', column: 'maxPluginCallsPerMonth', kind: 'soft', monthly: true, unit: 'count', label: 'Plugin requests a month', hint: 'Soft: every request and event a plugin handles (each one runs the plugin on your Cloudflare account). You get a notice at 80% and 100%; nothing is blocked.' },
  { key: 'database', column: 'maxDatabaseBytes', kind: 'soft', monthly: false, unit: 'bytes', label: 'Database size', hint: 'Soft: roughly how much of the shared database the site’s pages, revisions, emails, form entries, comments and plugin data take, measured nightly. You get a notice at 80% and 100%; nothing is blocked.' },
] as const

export type PlanLimitKey = typeof PLAN_LIMITS[number]['key']
export type PlanLimitColumn = typeof PLAN_LIMITS[number]['column']

export function planLimit(key: PlanLimitKey) {
  return PLAN_LIMITS.find(l => l.key === key)!
}

/**
 * Yes/no features a plan can include, each a boolean `hosting_plans` column (default off).
 * A site with no plan — and every site while the hosting-platform switch is off — has
 * every feature.
 */
export const PLAN_FEATURES = [
  { key: 'imageTransformations', column: 'allowImageTransformations', label: 'Image resizing (Cloudflare Image Transformations)', hint: 'Lets the site resize and convert images on the fly. Billed to your Cloudflare zone: 5,000 unique transformations a month free, then $0.50 per 1,000.' },
] as const

export type PlanFeatureKey = typeof PLAN_FEATURES[number]['key']
export type PlanFeatureColumn = typeof PLAN_FEATURES[number]['column']

export function planFeature(key: PlanFeatureKey) {
  return PLAN_FEATURES.find(f => f.key === key)!
}
