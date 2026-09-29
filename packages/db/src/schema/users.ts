import { sqliteTable, text, integer, index, uniqueIndex, customType } from 'drizzle-orm/sqlite-core'
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

// Target of ON DELETE CASCADE from sessions, accounts, user_site_roles, api_keys,
// passkeys, audit_logs, notifications, and subscriptions (all keyed on userId), plus ON
// DELETE SET NULL from content_items/content_revisions/comments (authorId),
// media/video_assets (uploadedBy), and form_submissions (userId) — same DROP-TABLE-
// triggers-FK-actions landmine documented in full on `sites` in sites.ts. A future
// table-rebuild migration on `users` would silently mass-delete or null out all of the
// above, for every user, with no error. Verify against a real D1 deploy first, or
// hand-write the migration to avoid drizzle-kit's rebuild strategy.
// Better Auth core tables
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  phone: text('phone'),
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
  // Better Auth 1.7+ scopes account identity by (issuer, accountId) rather than
  // (providerId, accountId) alone. Built-in OAuth providers with no OIDC issuer of their
  // own (google, github) get the synthetic `local:oauth:<providerId>` issuer;
  // email/password accounts get `local:credential`.
  issuer: text('issuer').notNull().default(''),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  // expiresAt kept for backward compatibility with existing rows; new OAuth tokens use the fields below
  expiresAt: dateText('expires_at'),
  accessTokenExpiresAt: dateText('access_token_expires_at'),
  refreshTokenExpiresAt: dateText('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: dateText('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_accounts_user').on(t.userId),
  index('idx_accounts_provider').on(t.providerId, t.accountId),
  uniqueIndex('idx_accounts_issuer_account_id').on(t.issuer, t.accountId),
])

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: dateText('expires_at').notNull(),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: dateText('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_verifications_identifier').on(t.identifier),
])

// Per-site user roles
export const userSiteRoles = sqliteTable('user_site_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['super_admin', 'admin', 'editor', 'author', 'viewer', 'member'] }).notNull().default('viewer'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  // Unique, not just indexed: without this, two concurrent invites for the same
  // not-yet-member (email, site) pair (a double-click, or two admins inviting
  // simultaneously) could both pass a "not already a member" SELECT check and both
  // insert, producing duplicate role rows with nothing at the DB level to stop it.
  // requireAuth()/requireRole()/hasSuperAdminRole() all resolve role via .findFirst()
  // with no ORDER BY, so which duplicate "won" for permission checks was nondeterministic.
  uniqueIndex('idx_user_site_roles_user_site').on(t.userId, t.siteId),
  index('idx_user_site_roles_site').on(t.siteId),
])

// A role waiting on proof of mailbox ownership. Created when an admin invites (or a
// backup restore names) an email whose existing account is *unclaimed* — never verified
// and never granted a staff role anywhere (see isUnclaimedAccount in
// server/utils/user-provisioning.ts), i.e. possibly pre-registered by someone else to
// catch the invite. The role row is only written once the mailbox owner completes the
// emailed set-password link (onPasswordReset in server/utils/better-auth.ts). Nothing
// about the existing account changes until then, so one tenant inviting an address can't
// lock its owner out of the account they already use on other sites.
export const siteInvitations = sqliteTable('site_invitations', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'editor', 'author', 'viewer', 'member'] }).notNull(),
  invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('idx_site_invitations_site_user').on(t.siteId, t.userId),
  index('idx_site_invitations_user').on(t.userId),
])

// ── Tenant-domain sign-in ────────────────────────────────────────────────────────────
// Passwords, passkeys and every account-wide action live only on the dedicated accounts
// origin (NUXT_PUBLIC_ACCOUNTS_URL), where no tenant's code ever runs — its Better Auth
// session is a row in `sessions`. A site's own domain instead gets a *site session*: a
// login valid for that one site only, issued through a one-time code after signing in on
// the accounts origin (server/utils/site-auth.ts). A tenant admin's custom script on
// their own domain can therefore only ever act as the visitor on that same site — never
// on another site, and never on the account itself.
//
// `parentSessionId` ties each site session to the accounts-origin session that created
// it: signing out there, a password reset, or account deletion removes the parent row
// and cascades here, ending every site login at once. That makes `sessions` a cascade
// target — a table-rebuild migration on it would log everyone out of every site (no data
// loss, but see the landmine note on `users` above before rebuilding it anyway).
export const siteSessions = sqliteTable('site_sessions', {
  id: text('id').primaryKey(),
  // SHA-256 of the cookie value — the raw token is never stored.
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  parentSessionId: text('parent_session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_site_sessions_user').on(t.userId),
  index('idx_site_sessions_parent').on(t.parentSessionId),
])

// Single-use, ~60-second codes handed from the accounts origin back to a site's own
// domain (like an OAuth authorization code) and exchanged there, server-side, for a
// site session. Stored hashed; deleted on use.
export const siteAuthCodes = sqliteTable('site_auth_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  parentSessionId: text('parent_session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

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

// Physical table name is singular ('passkey'), unlike every other table here — this is
// required by the better-auth passkey plugin's own expected table name, not an oversight.
export const passkeys = sqliteTable('passkey', {
  id: text('id').primaryKey(),
  name: text('name'),
  publicKey: text('public_key').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialID: text('credential_id').notNull(),
  counter: integer('counter').notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
  transports: text('transports'),
  aaguid: text('aaguid'),
  createdAt: dateText('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_passkeys_user').on(t.userId),
])

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  siteRoles: many(userSiteRoles),
  passkeys: many(passkeys),
}))

export const userSiteRolesRelations = relations(userSiteRoles, ({ one }) => ({
  user: one(users, { fields: [userSiteRoles.userId], references: [users.id] }),
  site: one(sites, { fields: [userSiteRoles.siteId], references: [sites.id] }),
}))

export const siteInvitationsRelations = relations(siteInvitations, ({ one }) => ({
  user: one(users, { fields: [siteInvitations.userId], references: [users.id] }),
  site: one(sites, { fields: [siteInvitations.siteId], references: [sites.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  users: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, { fields: [passkeys.userId], references: [users.id] }),
}))
