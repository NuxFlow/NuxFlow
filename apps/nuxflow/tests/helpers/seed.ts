/**
 * Seed helpers for integration tests.
 * Each helper inserts a row into the test database and returns the generated ID.
 */

import { ulid } from 'ulid'
import { sql } from 'drizzle-orm'
import {
  sites,
  users,
  accounts,
  userSiteRoles,
  contentTypes,
  contentItems,
  membershipTiers,
  subscriptions,
  siteSettings,
} from '@nuxflow/db/schema'
import type { TestDb } from './db'

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export async function seedSite(db: TestDb, overrides: Partial<typeof sites.$inferInsert> = {}) {
  const id = overrides.id ?? ulid()
  await db.insert(sites).values({
    id,
    name: 'Test Site',
    domain: 'test.localhost',
    status: 'active',
    setupCompleted: true,
    ...overrides,
  })
  return id
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function seedUser(db: TestDb, overrides: Partial<typeof users.$inferInsert> = {}) {
  const id = overrides.id ?? ulid()
  await db.insert(users).values({
    id,
    name: 'Test User',
    email: `user-${id.toLowerCase()}@example.com`,
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })

  // Insert a credential account so Better Auth is satisfied
  await db.insert(accounts).values({
    id: ulid(),
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: '$argon2id$test-hash',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  return id
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type Role = 'super_admin' | 'admin' | 'editor' | 'author' | 'member' | 'viewer'

export async function seedRole(db: TestDb, userId: string, siteId: string, role: Role) {
  await db.insert(userSiteRoles).values({
    id: ulid(),
    userId,
    siteId,
    role,
  }).onConflictDoNothing()
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export async function seedContentType(
  db: TestDb,
  siteId: string,
  overrides: Partial<typeof contentTypes.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid()
  await db.insert(contentTypes).values({
    id,
    siteId,
    name: 'Page',
    singularName: 'Page',
    slug: 'page',
    hasComments: false,
    ...overrides,
  })
  return id
}

export async function seedContentItem(
  db: TestDb,
  siteId: string,
  typeId: string,
  overrides: Partial<typeof contentItems.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid()
  await db.insert(contentItems).values({
    id,
    siteId,
    typeId,
    title: 'Test Page',
    slug: `test-page-${id.toLowerCase()}`,
    status: 'published',
    visibility: 'public',
    content: JSON.stringify({ type: 'doc', content: [] }),
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })
  return id
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export async function seedTier(
  db: TestDb,
  siteId: string,
  overrides: Partial<typeof membershipTiers.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid()
  await db.insert(membershipTiers).values({
    id,
    siteId,
    name: 'Pro',
    slug: 'pro',
    price: 999,
    currency: 'USD',
    interval: 'month',
    isActive: true,
    features: ['Feature 1', 'Feature 2'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })
  return id
}

export async function seedSubscription(
  db: TestDb,
  siteId: string,
  userId: string,
  tierId: string,
  overrides: Partial<typeof subscriptions.$inferInsert> = {},
) {
  const id = overrides.id ?? ulid()
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  await db.insert(subscriptions).values({
    id,
    siteId,
    userId,
    tierId,
    provider: 'stripe',
    status: 'active',
    providerSubscriptionId: `sub_test_${id.toLowerCase()}`,
    currentPeriodEnd: periodEnd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })
  return id
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function seedSetting(db: TestDb, siteId: string, key: string, value: string) {
  await db.insert(siteSettings).values({
    id: ulid(),
    siteId,
    key,
    value,
    updatedAt: sql`(datetime('now'))`,
  }).onConflictDoNothing()
}
