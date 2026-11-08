import { describe, it, expect } from 'vitest'
import { SETTING_GROUPS, SETTING_GROUP_IDS, settingGroup } from '../../shared/lib/setting-groups'

describe('settingGroup()', () => {
  it('groups settings by prefix', () => {
    expect(settingGroup('frontend.show_header', false)).toBe('appearance')
    expect(settingGroup('theme.primary_color', false)).toBe('appearance')
    expect(settingGroup('appearance.custom_head_html', false)).toBe('appearance')
    expect(settingGroup('seo.title', false)).toBe('seo')
    expect(settingGroup('email.from_name', false)).toBe('email')
    expect(settingGroup('ai.provider', false)).toBe('ai')
    expect(settingGroup('auth.allow_public_registration', false)).toBe('integrations')
    expect(settingGroup('notificationEmail', false)).toBe('other')
  })

  it('puts sensitive keys in credentials, whatever their prefix', () => {
    expect(settingGroup('payments.stripe_secret_key', true)).toBe('credentials')
    expect(settingGroup('ai.openai_api_key', true)).toBe('credentials')
  })

  it("keeps the original site's identifiers together, push keys included", () => {
    expect(settingGroup('seo.canonical_url', false)).toBe('site')
    expect(settingGroup('seo.verify_google', false)).toBe('site')
    expect(settingGroup('push.vapid_public_key', false)).toBe('site')
    // Sensitive, but must travel with its public key.
    expect(settingGroup('push.vapid_private_key', true)).toBe('site')
  })

  it('lists every group once, with only the site-specific and credential groups off by default', () => {
    expect(SETTING_GROUPS.map(g => g.id)).toEqual([...SETTING_GROUP_IDS])
    expect(SETTING_GROUPS.filter(g => !g.defaultOn).map(g => g.id)).toEqual(['site', 'credentials'])
  })
})
