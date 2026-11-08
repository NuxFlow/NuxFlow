// Site settings grouped for backup and restore, so a restore can take, say, the look and
// the SEO wording from a backup without its payment keys. Import-free: the Restore tab and
// the restore code read the same list.

export const SETTING_GROUP_IDS = [
  'appearance', 'seo', 'email', 'payments', 'ai', 'integrations', 'other', 'site', 'credentials',
] as const
export type SettingGroupId = typeof SETTING_GROUP_IDS[number]

export interface SettingGroup {
  id: SettingGroupId
  label: string
  description: string
  /** Ticked when the Restore tab opens. */
  defaultOn: boolean
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  { id: 'appearance', label: 'Appearance', description: 'Colours, fonts, header, logo, custom HTML', defaultOn: true },
  { id: 'seo', label: 'SEO & AI crawlers', description: 'Site title and description, robots, llms.txt, IndexNow', defaultOn: true },
  { id: 'email', label: 'Email', description: 'Provider, sender name and address, mailing list', defaultOn: true },
  { id: 'payments', label: 'Payments', description: 'Provider choices and sign-up options (not the keys)', defaultOn: true },
  { id: 'ai', label: 'AI', description: 'Provider and model choices (not the keys)', defaultOn: true },
  { id: 'integrations', label: 'Sign-in & integrations', description: 'Registration, social sign-in ids, Turnstile, push events, media', defaultOn: true },
  { id: 'other', label: 'Other settings', description: 'Everything not in another group', defaultOn: true },
  {
    id: 'site',
    label: 'Tied to the original site',
    description: 'Canonical address, search-engine verification codes, IndexNow key, push keys, Cloudflare account id. Tick when restoring the same site.',
    defaultOn: false,
  },
  {
    id: 'credentials',
    label: 'Passwords & API keys',
    description: 'Only in backups downloaded with "Include passwords and API keys".',
    defaultOn: false,
  },
]

// Values that identify the site a backup came from. Restoring them onto another site
// points search engines at the wrong address or breaks its push subscriptions. Checked
// before the credentials group, so both push keys travel together.
const SITE_SPECIFIC_KEYS = new Set([
  'seo.canonical_url',
  'seo.indexnow_key',
  'seo.verify_google',
  'seo.verify_bing',
  'seo.verify_pinterest',
  'seo.verify_yandex',
  'push.vapid_public_key',
  'push.vapid_private_key',
  'cloudflare.account_id',
])

/** Both push keys: one without the other breaks push, so they're exported together or not at all. */
export const PUSH_KEY_SETTINGS = ['push.vapid_public_key', 'push.vapid_private_key'] as const

const PREFIX_GROUPS: [string, SettingGroupId][] = [
  ['theme.', 'appearance'],
  ['frontend.', 'appearance'],
  ['layout.', 'appearance'],
  ['appearance.', 'appearance'],
  ['seo.', 'seo'],
  ['email.', 'email'],
  ['mailing_list.', 'email'],
  ['payments.', 'payments'],
  ['ai.', 'ai'],
  ['auth.', 'integrations'],
  ['integrations.', 'integrations'],
  ['push.', 'integrations'],
  ['cloudflare.', 'integrations'],
  ['media.', 'integrations'],
  ['sms.', 'integrations'],
]

/**
 * The group a setting belongs to. `isSensitive` = the key is in SENSITIVE_SETTING_KEYS
 * (server-only, so the caller passes it in).
 */
export function settingGroup(key: string, isSensitive: boolean): SettingGroupId {
  if (SITE_SPECIFIC_KEYS.has(key)) return 'site'
  if (isSensitive) return 'credentials'
  return PREFIX_GROUPS.find(([prefix]) => key.startsWith(prefix))?.[1] ?? 'other'
}

export function isSettingGroupId(value: string): value is SettingGroupId {
  return (SETTING_GROUP_IDS as readonly string[]).includes(value)
}
