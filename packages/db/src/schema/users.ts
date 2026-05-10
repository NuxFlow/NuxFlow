import { sqliteTable, text, integer, index, customType } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'
import { sites } from './sites'

// D1 does not accept JavaScript Date objects as bind parameters — only strings,
// numbers, booleans, null, and ArrayBuffer. Better Auth's drizzle adapter passes
// Date objects for all timestamp fields, so we use a custom column type that
// converts Date → ISO string transparently on insert/update while keeping the
// stored column as plain TEXT. Existing code that passes strings is unaffected.
const dateText = customType<{ data: string; driverData: string }>({
  dataType() { return 'text' },
  toDriver(value: string): string {
    const v = value as unknown
    if (v == null) return null as unknown as string
    return v instanceof Date ? (v as Date).toISOString() : String(v)
  },
})

// Better Auth core tables
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: dateText('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: dateText('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: dateText('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_sessions_user').on(t.userId),
])

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  expiresAt: dateText('expires_at'),
  password: text('password'),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: dateText('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_accounts_user').on(t.userId),
])

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: dateText('expires_at').notNull(),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: dateText('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Per-site user roles
export const userSiteRoles = sqliteTable('user_site_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['super_admin', 'admin', 'editor', 'author', 'viewer', 'member'] }).notNull().default('viewer'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_user_site_roles_user_site').on(t.userId, t.siteId),
])

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default([]),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_api_keys_site').on(t.siteId),
])

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  siteRoles: many(userSiteRoles),
}))

export const userSiteRolesRelations = relations(userSiteRoles, ({ one }) => ({
  user: one(users, { fields: [userSiteRoles.userId], references: [users.id] }),
  site: one(sites, { fields: [userSiteRoles.siteId], references: [sites.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  users: one(users, { fields: [sessions.userId], references: [users.id] }),
}))
