/**
 * The tenant query guard itself (tests/helpers/tenant-query-guard.ts): its SQL rule, its
 * allowlist matching, and that it really sees the statements server code runs — if the
 * wiring in tests/helpers/db.ts broke, every other test file would pass without checking
 * anything.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { contentItems } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite } from '../helpers/seed'
import { ALLOWLIST, SITE_SCOPED_TABLES, checkStatement, statementsChecked } from '../helpers/tenant-query-guard'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { resolveSetting } = await import('../../server/utils/settings')

const ROUTE = 'server/api/v1/example.get.ts:10'

beforeAll(async () => {
  await initTestDb()
  await seedSite(getCurrentTestDb(), { id: 'site-guard' })
})

afterAll(async () => {
  await teardownTestDb()
})

describe('which tables are site-scoped', () => {
  it('derives the list from the schema', () => {
    expect(SITE_SCOPED_TABLES.has('content_items')).toBe(true)
    expect(SITE_SCOPED_TABLES.has('user_site_roles')).toBe(true)
    // Global tables: accounts are shared, and a site row is the tenant itself.
    expect(SITE_SCOPED_TABLES.has('users')).toBe(false)
    expect(SITE_SCOPED_TABLES.has('sites')).toBe(false)
  })
})

describe('the rule', () => {
  it('flags a by-id read of a site-scoped table', () => {
    expect(checkStatement('select "id" from "content_items" "contentItems" where "contentItems"."id" = ? limit ?', ROUTE))
      .toEqual(['content_items'])
  })

  it('flags an update or delete without a site_id condition', () => {
    expect(checkStatement('update "menus" set "items" = ? where "menus"."id" = ?', ROUTE)).toEqual(['menus'])
    expect(checkStatement('delete from "email_messages" where "email_messages"."id" = ?', ROUTE)).toEqual(['email_messages'])
  })

  it('does not count site_id in the selected columns as a filter', () => {
    expect(checkStatement('select "id", "site_id" from "media" where "media"."id" = ?', ROUTE)).toEqual(['media'])
  })

  it('accepts =, IN and join comparisons on site_id, and raw unquoted SQL', () => {
    expect(checkStatement('select "id" from "content_items" where ("content_items"."id" = ? and "content_items"."site_id" = ?)', ROUTE)).toEqual([])
    expect(checkStatement('select "id" from "media" where "media"."site_id" in (?, ?)', ROUTE)).toEqual([])
    expect(checkStatement('select a.id from forms a join form_submissions b on b.form_id = a.id and b.site_id = a.site_id', ROUTE)).toEqual([])
    expect(checkStatement('SELECT id FROM content_items WHERE site_id = ? AND status = ?', ROUTE)).toEqual([])
  })

  it('ignores inserts and tables without a site_id column', () => {
    expect(checkStatement('insert into "content_items" ("id", "site_id") values (?, ?)', ROUTE)).toEqual([])
    expect(checkStatement('select "id" from "users" where "users"."email" = ?', ROUTE)).toEqual([])
  })
})

describe('the allowlist', () => {
  it('covers a listed file only for its listed tables', () => {
    const job = 'server/scheduled/publish-scheduled.ts:30'
    expect(checkStatement('update "content_items" set "status" = ? where "content_items"."status" = ?', job)).toEqual([])
    expect(checkStatement('delete from "media" where "media"."id" = ?', job)).toEqual(['media'])
  })

  it('applies a pattern-only entry from any file, and only to matching SQL', () => {
    const superAdminCheck = 'select "id" from "user_site_roles" "userSiteRoles" where ("userSiteRoles"."user_id" = ? and "userSiteRoles"."role" = ?) limit ?'
    expect(checkStatement(superAdminCheck, ROUTE)).toEqual([])
    expect(checkStatement('delete from "user_site_roles" where "user_site_roles"."user_id" = ?', ROUTE)).toEqual(['user_site_roles'])
  })

  it('gives every entry a reason and a file or pattern to match on', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim().length, JSON.stringify(entry)).toBeGreaterThan(20)
      expect(entry.file !== undefined || entry.match !== undefined, entry.reason).toBe(true)
    }
  })
})

describe('wiring', () => {
  it('checks statements run by server code, and not the tests’ own queries', async () => {
    const before = statementsChecked()
    await getCurrentTestDb().select().from(contentItems)
    expect(statementsChecked()).toBe(before)

    await resolveSetting(createMockEvent({ siteId: 'site-guard' }) as unknown as H3Event, 'guard.test_key')
    expect(statementsChecked()).toBeGreaterThan(before)
  })
})
