import { describe, it, expect } from 'vitest'
import { demoBlockReason, demoBlockedContent, demoBlockedSettings } from '../../server/utils/demo-mode'

describe('demoBlockReason', () => {
  const blocked = (method: string, path: string) => demoBlockReason(method, path) !== null

  it('allows only sign-in and sign-out among Better Auth actions', () => {
    expect(blocked('POST', '/api/auth/sign-in/email')).toBe(false)
    expect(blocked('POST', '/api/auth/sign-out')).toBe(false)
    expect(blocked('GET', '/api/auth/get-session')).toBe(false)
    for (const path of [
      '/api/auth/change-password',
      '/api/auth/change-email',
      '/api/auth/update-user',
      '/api/auth/delete-user',
      '/api/auth/passkey/add-passkey',
      '/api/auth/request-password-reset',
      '/api/auth/sign-in/social',
    ]) expect(blocked('POST', path), path).toBe(true)
  })

  it('blocks AI, MCP, the accounts APIs and the platform screens for every method', () => {
    for (const path of ['/api/v1/ai/improve', '/api/v1/ai/generate', '/api/v1/mcp', '/api/public/listen/hello', '/api/accounts/hosting/checkout', '/api/v1/admin/db-export', '/api/v1/admin/platform']) {
      expect(blocked('GET', path), path).toBe(true)
      expect(blocked('POST', path), path).toBe(true)
    }
  })

  it('blocks writes that cost money or hand out access, but keeps those screens readable', () => {
    for (const path of ['/api/v1/api-keys', '/api/v1/dynamic-plugins', '/api/v1/dynamic-plugins/x/enable', '/api/v1/account', '/api/v1/account/post-address', '/api/v1/restore', '/api/v1/import/wordpress/items', '/api/v1/media/video/token', '/api/public/auth/register', '/api/v1/setup/complete']) {
      expect(blocked('POST', path), path).toBe(true)
    }
    expect(blocked('DELETE', '/api/v1/account')).toBe(true)
    expect(blocked('GET', '/api/v1/api-keys')).toBe(false)
    expect(blocked('GET', '/api/v1/dynamic-plugins')).toBe(false)
    expect(blocked('PUT', '/api/v1/account/notification-preferences')).toBe(false)
  })

  it('blocks theme uploads and super-admin grants but not the theme tools', () => {
    expect(blocked('POST', '/api/v1/themes')).toBe(true)
    expect(blocked('POST', '/api/v1/users/abc/super-admin')).toBe(true)
    expect(blocked('POST', '/api/v1/themes/abc/activate')).toBe(false)
    expect(blocked('POST', '/api/v1/themes/customizer')).toBe(false)
  })

  it('leaves the product tour alone', () => {
    for (const [method, path] of [
      ['POST', '/api/v1/content'],
      ['PATCH', '/api/v1/content/abc'],
      ['POST', '/api/v1/media/upload'],
      ['PATCH', '/api/v1/settings'],
      ['POST', '/api/v1/menus'],
      ['GET', '/'],
      ['GET', '/admin'],
    ] as const) expect(blocked(method, path), `${method} ${path}`).toBe(false)
  })

  it('ignores a trailing slash and lookalike prefixes', () => {
    expect(blocked('POST', '/api/v1/api-keys/')).toBe(true)
    expect(blocked('POST', '/api/v1/accountant')).toBe(false)
  })
})

describe('demoBlockedSettings', () => {
  it('refuses custom HTML, credentials and domain claims', () => {
    expect(demoBlockedSettings({
      settings: {
        'appearance.custom_head_html': '<script>',
        'email.provider': 'resend',
        'seo.verify_google': 'abc',
        'seo.canonical_url': 'https://evil.example',
        'theme.primary_color': '#000',
        'seo.title': 'Fine',
      },
    })).toEqual(['appearance.custom_head_html', 'email.provider', 'seo.verify_google', 'seo.canonical_url'])
    expect(demoBlockedSettings({ ai: { provider: 'openai' }, domain: 'x.com', status: 'maintenance' })).toEqual(['domain', 'status', 'ai'])
  })

  it('allows ordinary appearance and SEO changes', () => {
    expect(demoBlockedSettings({ settings: { 'theme.dark_mode': 'dark', 'seo.description': 'Hi' } })).toEqual([])
  })
})

describe('demoBlockedContent', () => {
  it('finds the HTML block at any depth', () => {
    expect(demoBlockedContent({ type: 'canvas', blocks: [{ id: '1', type: 'html-block/html', props: {} }] })).toBe(true)
    expect(demoBlockedContent({
      type: 'canvas',
      blocks: [{ id: '1', type: 'canvas-columns', props: { columns: [{ blocks: [{ type: 'html-block/html' }] }] } }],
    })).toBe(true)
  })

  it('passes ordinary pages and posts', () => {
    expect(demoBlockedContent({ type: 'canvas', blocks: [{ id: '1', type: 'canvas-hero', props: { headline: 'html-block/html' } }] })).toBe(false)
    expect(demoBlockedContent({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false)
    expect(demoBlockedContent(null)).toBe(false)
  })
})
