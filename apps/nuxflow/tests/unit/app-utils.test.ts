/**
 * Unit tests for the Vue app's pure utilities (app/utils/*).
 *
 * admin-nav.ts is presentation-only, but CLAUDE.md requires each section's minRole to
 * match its server route's real minimum — so beyond the logic tests, a drift test reads
 * the guard straight out of each section's backing server route and fails if they diverge
 * (hiding a section a role can use, or showing one that will just 403).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ADMIN_NAV, SUPER_ADMIN_NAV, canAccessNavItem, findNavRule, roleAtLeast, type Role } from '../../app/utils/admin-nav'
import { evaluateArithmeticExpression } from '../../app/utils/safe-math'
import { formatBytes, formatDuration, formatPrice } from '../../app/utils/format'
import { getErrorMessage } from '../../app/utils/errors'

const ALL_ROLES: Role[] = ['viewer', 'member', 'author', 'editor', 'admin', 'super_admin']

describe('admin-nav', () => {
  it('ranks roles', () => {
    expect(roleAtLeast('admin', 'editor')).toBe(true)
    expect(roleAtLeast('editor', 'admin')).toBe(false)
    expect(roleAtLeast('member', 'viewer')).toBe(true)
    expect(roleAtLeast(null, 'viewer')).toBe(false)
    expect(roleAtLeast(undefined, 'viewer')).toBe(false)
  })

  it('gates super-admin items on isSuperAdmin alone, not on role', () => {
    const sites = SUPER_ADMIN_NAV[0]!
    expect(canAccessNavItem(sites, { role: 'super_admin', isSuperAdmin: false })).toBe(false)
    expect(canAccessNavItem(sites, { role: 'viewer', isSuperAdmin: true })).toBe(true)
    expect(canAccessNavItem(sites, null)).toBe(false)
  })

  it('shows a user with no role on the site nothing', () => {
    for (const item of ADMIN_NAV) expect(canAccessNavItem(item, { role: null, isSuperAdmin: false })).toBe(false)
  })

  it('matches the longest nav prefix for a path', () => {
    expect(findNavRule('/admin/content/generate')?.label).toBe('Generate with AI')
    expect(findNavRule('/admin/content/01ABC')?.label).toBe('Content')
    expect(findNavRule('/admin/media/videos/x')?.label).toBe('Videos')
    expect(findNavRule('/admin')?.label).toBe('Dashboard')
    expect(findNavRule('/admin/contentious')?.label).toBe('Dashboard')
    expect(findNavRule('/admin/super/database')?.superAdminOnly).toBe(true)
    expect(findNavRule('/elsewhere')).toBeUndefined()
  })

  // Each nav section → the server route its page can't work without.
  const BACKING_ROUTE: Record<string, string> = {
    '/admin/content/generate': 'server/api/v1/ai/generate/index.post.ts',
    '/admin/calendar': 'server/api/v1/content/calendar.get.ts',
    '/admin/taxonomies': 'server/api/v1/taxonomies/index.get.ts',
    '/admin/comments': 'server/api/v1/comments/index.get.ts',
    '/admin/menus': 'server/api/v1/menus/index.get.ts',
    '/admin/media': 'server/api/v1/media/index.get.ts',
    '/admin/media/videos': 'server/api/v1/media/video/index.get.ts',
    '/admin/forms': 'server/api/v1/forms/index.get.ts',
    '/admin/contact-forms': 'server/api/v1/contact/submissions.get.ts',
    '/admin/users': 'server/api/v1/users/index.get.ts',
    '/admin/memberships': 'server/api/v1/memberships/index.get.ts',
    '/admin/themes': 'server/api/v1/themes/index.get.ts',
    '/admin/plugins': 'server/api/v1/dynamic-plugins/index.get.ts',
    '/admin/import': 'server/api/v1/import/wordpress.post.ts',
    '/admin/settings': 'server/api/v1/settings/index.get.ts',
    '/admin/super/sites': 'server/api/v1/admin/sites/index.get.ts',
    '/admin/super/database': 'server/api/v1/admin/db-stats.get.ts',
  }

  function serverMinimum(file: string): { role: Role } | { superAdmin: true } {
    const src = readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8')
    if (/requireSuperAdmin\(event\)/.test(src)) return { superAdmin: true }
    const m = src.match(/requireRole\(event, '([a-z_]+)'\)/)
    if (m) return { role: m[1] as Role }
    if (/requireAuth\(event\)/.test(src)) return { role: 'viewer' }
    throw new Error(`No recognised guard in ${file}`)
  }

  it.each(Object.entries(BACKING_ROUTE))('%s matches the server guard in its backing route', (to, file) => {
    const item = [...ADMIN_NAV, ...SUPER_ADMIN_NAV].find(i => i.to === to)
    expect(item, `nav item ${to}`).toBeDefined()
    const server = serverMinimum(file)
    if ('superAdmin' in server) {
      expect(item!.superAdminOnly).toBe(true)
      return
    }
    const clientMin = item!.minRole ?? 'viewer'
    // Same effective gate for every role, rather than string equality (viewer ≡ no minRole).
    for (const role of ALL_ROLES) {
      expect(roleAtLeast(role, clientMin), `${role} on ${to}`).toBe(roleAtLeast(role, server.role))
    }
  })
})

describe('evaluateArithmeticExpression', () => {
  it.each([
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 / 4', 2.5],
    ['10 % 3', 1],
    ['-3 + +5', 2],
    ['--2', 2],
    ['1.5 * 2', 3],
    ['  7  ', 7],
  ])('%s = %d', (expr, expected) => {
    expect(evaluateArithmeticExpression(expr)).toBe(expected)
  })

  it.each([
    'alert(1)',
    'constructor.constructor("return process")()',
    '1; 2',
    '2 ** 3',
    '(1 + 2',
    '1 +',
    '',
    '1.2.3',
    '[]',
    '1e3',
  ])('rejects non-arithmetic input: %s', (expr) => {
    expect(() => evaluateArithmeticExpression(expr)).toThrow()
  })

  it('follows IEEE semantics for division by zero rather than throwing', () => {
    expect(evaluateArithmeticExpression('1 / 0')).toBe(Infinity)
  })
})

describe('format', () => {
  it('formats bytes across unit thresholds', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(null)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20.0 MB')
    expect(formatBytes(5 * 1024 ** 5)).toBe('5120.0 TB')
  })

  it('formats durations as m:ss', () => {
    expect(formatDuration(null)).toBe('--:--')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65.9)).toBe('1:05')
    expect(formatDuration(3600)).toBe('60:00')
  })

  it('formats prices with the currency and no forced decimals', () => {
    expect(formatPrice(10, 'USD')).toBe('$10')
    expect(formatPrice(9.99, 'EUR')).toBe('€9.99')
  })
})

describe('getErrorMessage', () => {
  it('prefers the server payload message, then the error message, then the fallback', () => {
    expect(getErrorMessage({ data: { message: 'server says' }, message: 'fetch failed' }, 'fb')).toBe('server says')
    expect(getErrorMessage(new Error('network down'), 'fb')).toBe('network down')
    expect(getErrorMessage(null, 'fb')).toBe('fb')
    expect(getErrorMessage('a string', 'fb')).toBe('fb')
  })
})
