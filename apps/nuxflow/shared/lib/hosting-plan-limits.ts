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
  { key: 'ai', column: 'maxAiCallsPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'AI calls a month', hint: 'Text, images, dictation, “Listen”, and background spam checks.' },
  { key: 'emails', column: 'maxEmailsPerMonth', kind: 'hard', monthly: true, unit: 'count', label: 'Emails a month', hint: 'Per recipient. Sign-in, password and security emails are never blocked.' },
  { key: 'views', column: 'maxViewsPerMonth', kind: 'soft', monthly: true, unit: 'count', label: 'Page views a month', hint: 'Soft: you get a notice at 80% and 100%; nothing is blocked.' },
  { key: 'renders', column: 'maxRendersPerMonth', kind: 'soft', monthly: true, unit: 'count', label: 'Server renders a month', hint: 'Soft: you get a notice at 80% and 100%; nothing is blocked.' },
] as const

export type PlanLimitKey = typeof PLAN_LIMITS[number]['key']
export type PlanLimitColumn = typeof PLAN_LIMITS[number]['column']

export function planLimit(key: PlanLimitKey) {
  return PLAN_LIMITS.find(l => l.key === key)!
}
