import { describe, it, expect } from 'vitest'
import { ASSIGNABLE_ROLES, ROLES, ROLE_LABELS, isTeamRole, roleAtLeast } from '@nuxflow/db/roles'
import { userSiteRoles, siteInvitations } from '@nuxflow/db/schema'
import { settingToBoolean, settingToString } from '../../server/utils/settings'

describe('role model', () => {
  it('drives the user_site_roles and site_invitations column enums', () => {
    expect(userSiteRoles.role.enumValues).toEqual([...ROLES])
    expect(siteInvitations.role.enumValues).toEqual([...ASSIGNABLE_ROLES])
  })

  it('never lets a site admin hand out super_admin', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('super_admin')
  })

  it('labels every role', () => {
    for (const role of ROLES) expect(ROLE_LABELS[role]).toBeTruthy()
  })

  it('ranks roles, with no role ranking below everything', () => {
    expect(roleAtLeast('admin', 'editor')).toBe(true)
    expect(roleAtLeast('author', 'editor')).toBe(false)
    expect(roleAtLeast(null, 'viewer')).toBe(false)
  })

  it('keeps members out of the team even though they outrank viewers', () => {
    expect(roleAtLeast('member', 'viewer')).toBe(true)
    expect(isTeamRole('member')).toBe(false)
    expect(isTeamRole('viewer')).toBe(true)
    expect(isTeamRole(null)).toBe(false)
  })
})

describe('typed setting readers', () => {
  it('reads switches saved as true or "true" as on, everything else as off', () => {
    expect(settingToBoolean(true)).toBe(true)
    expect(settingToBoolean('true')).toBe(true)
    for (const off of [false, 'false', '', null, undefined, 1, 'yes']) expect(settingToBoolean(off)).toBe(false)
  })

  it('reads text settings as strings, and anything that isn\'t text as empty', () => {
    expect(settingToString('sk_live_x')).toBe('sk_live_x')
    expect(settingToString(12345)).toBe('12345')
    for (const empty of [null, undefined, true, { a: 1 }, Number.NaN]) expect(settingToString(empty)).toBe('')
  })
})
