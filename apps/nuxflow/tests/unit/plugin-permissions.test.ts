import { describe, it, expect } from 'vitest'
import {
  describePermission, hostMatches, networkHostsOf, parsePluginCapabilities, permissionsCovered,
  samePermissions, validatePermission, validateSettingValue, type PluginSettingField,
} from '../../shared/lib/plugin-permissions'
import { egressBlockReason, type PluginEgressProps } from '../../server/utils/plugin-egress'

describe('validatePermission', () => {
  it('accepts every simple permission, network hosts and known hooks', () => {
    for (const p of ['storage', 'content:read', 'content:write', 'ai', 'notify', 'user:read', 'network:api.example.com', 'network:*.example.co.uk', 'hook:content.published', 'hook:form.submitted']) {
      expect(validatePermission(p), p).toBeNull()
    }
  })

  it('refuses unknown permissions, unknown hooks and non-public hosts', () => {
    for (const p of ['database', 'storage:all', 'hook:user.deleted', 'network:localhost', 'network:127.0.0.1', 'network:10.0.0.1', 'network:*.com', 'network:com', 'network:intranet.local', 'network:api.internal', 'network:https://api.example.com', 'network:API.example.com', 'network:']) {
      expect(validatePermission(p), p).not.toBeNull()
    }
  })
})

describe('hostMatches', () => {
  it('matches exact hosts and wildcard subdomains, never the apex or a look-alike', () => {
    expect(hostMatches('api.example.com', 'api.example.com')).toBe(true)
    expect(hostMatches('api.example.com', 'API.Example.com.')).toBe(true)
    expect(hostMatches('api.example.com', 'evil-api.example.com')).toBe(false)
    expect(hostMatches('*.example.com', 'a.b.example.com')).toBe(true)
    expect(hostMatches('*.example.com', 'example.com')).toBe(false)
    expect(hostMatches('*.example.com', 'evilexample.com')).toBe(false)
    expect(hostMatches('*.example.com', 'example.com.evil.net')).toBe(false)
  })
})

describe('parsePluginCapabilities', () => {
  it('de-duplicates and sorts permissions so equal sets compare equal', () => {
    const caps = parsePluginCapabilities({ permissions: ['storage', 'ai', 'storage'] })
    expect(caps.permissions).toEqual(['ai', 'storage'])
    expect(caps.settings).toEqual([])
    expect(samePermissions(caps.permissions, ['storage', 'ai'])).toBe(true)
  })

  it('validates the settings form', () => {
    expect(() => parsePluginCapabilities({ settings: [{ key: 'Bad Key', label: 'x', type: 'text' }] })).toThrow(/key/)
    expect(() => parsePluginCapabilities({ settings: [{ key: 'a', label: 'A', type: 'colour' }] })).toThrow(/type/)
    expect(() => parsePluginCapabilities({ settings: [{ key: 'a', label: 'A', type: 'select' }] })).toThrow(/options/)
    expect(() => parsePluginCapabilities({ settings: [{ key: 'a', label: 'A', type: 'secret', default: 'x' }] })).toThrow(/secret/)
    expect(() => parsePluginCapabilities({ settings: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }] })).toThrow(/duplicate/)
    expect(() => parsePluginCapabilities({ settings: [{ key: 'n', label: 'N', type: 'number', default: 'five' }] })).toThrow(/default/)
    const ok = parsePluginCapabilities({ settings: [{ key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'A', value: 'a' }], default: 'a' }] })
    expect(ok.settings[0]).toMatchObject({ key: 'mode', default: 'a' })
  })

  it('caps how many hosts and settings a plugin can ask for', () => {
    const hosts = Array.from({ length: 21 }, (_, i) => `network:h${i}.example.com`)
    expect(() => parsePluginCapabilities({ permissions: hosts })).toThrow(/at most/)
    const fields = Array.from({ length: 31 }, (_, i) => ({ key: `f${i}`, label: 'F', type: 'text' }))
    expect(() => parsePluginCapabilities({ settings: fields })).toThrow(/at most/)
  })

  it('refuses non-object input and bad permission shapes', () => {
    expect(() => parsePluginCapabilities(null)).toThrow()
    expect(() => parsePluginCapabilities({ permissions: 'storage' })).toThrow()
    expect(() => parsePluginCapabilities({ permissions: [1] })).toThrow()
  })
})

describe('validateSettingValue', () => {
  const f = (type: PluginSettingField['type'], extra: Partial<PluginSettingField> = {}): PluginSettingField => ({ key: 'k', label: 'K', type, ...extra })

  it('checks each type and the required flag', () => {
    expect(validateSettingValue(f('toggle'), true)).toBeNull()
    expect(validateSettingValue(f('toggle'), 'yes')).not.toBeNull()
    expect(validateSettingValue(f('number'), 3)).toBeNull()
    expect(validateSettingValue(f('number'), Number.NaN)).not.toBeNull()
    expect(validateSettingValue(f('url'), 'https://a.example')).toBeNull()
    expect(validateSettingValue(f('url'), 'javascript:alert(1)')).not.toBeNull()
    expect(validateSettingValue(f('select', { options: [{ label: 'A', value: 'a' }] }), 'b')).not.toBeNull()
    expect(validateSettingValue(f('text', { required: true }), '')).toBe('is required')
    expect(validateSettingValue(f('text'), '')).toBeNull()
  })
})

describe('permission sets and descriptions', () => {
  it('compares grants', () => {
    expect(permissionsCovered(['storage'], ['storage', 'ai'])).toBe(true)
    expect(permissionsCovered(['storage', 'network:a.example.com'], ['storage'])).toBe(false)
    expect(permissionsCovered(['storage'], null)).toBe(false)
    expect(permissionsCovered([], null)).toBe(true)
    expect(networkHostsOf(['storage', 'network:a.example.com'])).toEqual(['a.example.com'])
  })

  it('flags data-sharing permissions as high impact', () => {
    expect(describePermission('storage').risk).toBe('low')
    expect(describePermission('network:api.example.com').risk).toBe('high')
    expect(describePermission('hook:form.submitted').risk).toBe('high')
    expect(describePermission('hook:content.published').risk).toBe('low')
  })
})

describe('egressBlockReason', () => {
  const props: PluginEgressProps = { siteId: 's', pluginId: 'p', allowedHosts: ['api.example.com', '*.cdn.example.net'], blockedHosts: ['mysite.com'] }
  const reason = (u: string) => egressBlockReason(new URL(u), props)

  it('lets approved HTTPS hosts through', () => {
    expect(reason('https://api.example.com/v1/x')).toBeNull()
    expect(reason('https://img.cdn.example.net/a.png')).toBeNull()
  })

  it('blocks everything else', () => {
    expect(reason('http://api.example.com/')).toMatch(/https/)
    expect(reason('https://api.example.com:8443/')).toMatch(/port/)
    expect(reason('https://user:pw@api.example.com/')).toMatch(/credentials/)
    expect(reason('https://other.example.com/')).toMatch(/not in this plugin/)
    expect(reason('https://cdn.example.net/')).toMatch(/not in this plugin/)
    expect(egressBlockReason(new URL('https://mysite.com/'), { ...props, allowedHosts: ['mysite.com'] })).toMatch(/own address/)
    expect(egressBlockReason(new URL('https://127.0.0.1/'), { ...props, allowedHosts: ['127.0.0.1'] })).toMatch(/public address/)
  })
})
