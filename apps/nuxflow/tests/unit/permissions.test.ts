import { describe, it, expect } from 'vitest'
import { roleAtLeast } from '../../server/utils/permissions'
import type { Role } from '../../server/utils/permissions'

describe('roleAtLeast', () => {
  const allRoles: Role[] = ['super_admin', 'admin', 'editor', 'author', 'member', 'viewer']

  it('returns true when role equals the minimum', () => {
    for (const role of allRoles) {
      expect(roleAtLeast(role, role), `${role} >= ${role}`).toBe(true)
    }
  })

  it('super_admin satisfies every minimum', () => {
    for (const min of allRoles) {
      expect(roleAtLeast('super_admin', min), `super_admin >= ${min}`).toBe(true)
    }
  })

  it('viewer does not satisfy any minimum above viewer', () => {
    const aboveViewer: Role[] = ['member', 'author', 'editor', 'admin', 'super_admin']
    for (const min of aboveViewer) {
      expect(roleAtLeast('viewer', min), `viewer >= ${min}`).toBe(false)
    }
  })

  it('admin satisfies admin and below but not super_admin', () => {
    expect(roleAtLeast('admin', 'editor')).toBe(true)
    expect(roleAtLeast('admin', 'admin')).toBe(true)
    expect(roleAtLeast('admin', 'super_admin')).toBe(false)
  })

  it('editor satisfies author, member, viewer but not admin or above', () => {
    expect(roleAtLeast('editor', 'author')).toBe(true)
    expect(roleAtLeast('editor', 'viewer')).toBe(true)
    expect(roleAtLeast('editor', 'admin')).toBe(false)
    expect(roleAtLeast('editor', 'super_admin')).toBe(false)
  })

  it('author satisfies member and viewer but not editor or above', () => {
    expect(roleAtLeast('author', 'member')).toBe(true)
    expect(roleAtLeast('author', 'viewer')).toBe(true)
    expect(roleAtLeast('author', 'editor')).toBe(false)
  })

  it('role hierarchy is strictly ordered', () => {
    const ordered: Role[] = ['viewer', 'member', 'author', 'editor', 'admin', 'super_admin']
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        expect(roleAtLeast(ordered[i]!, ordered[j]!), `${ordered[i]} >= ${ordered[j]}`).toBe(i >= j)
      }
    }
  })
})
