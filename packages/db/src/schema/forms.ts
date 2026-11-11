import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

// Target of ON DELETE CASCADE from formSubmissions.formId below — same DROP-TABLE-
// triggers-FK-actions landmine documented in full on `sites` in sites.ts. A future
// rebuild migration on `forms` would silently delete every submission to every form,
// for every site, with no error; verify against a real D1 deploy first, or hand-write
// the migration.
export const forms = sqliteTable('forms', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  fields: text('fields', { mode: 'json' }).$type<FormField[]>().notNull().default([]),
  notifications: text('notifications', { mode: 'json' }).$type<Record<string, unknown>>(),
  redirectUrl: text('redirect_url'),
  status: text('status', { enum: ['active', 'draft', 'closed'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_forms_site_slug').on(t.siteId, t.slug),
])

export const formSubmissions = sqliteTable('form_submissions', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  status: text('status', { enum: ['new', 'read', 'spam', 'archived'] }).notNull().default('new'),
  // Bytes of uploaded files kept in R2 for this submission (`_private/<siteId>/forms/…`),
  // counted towards the storage plan limit like media and inbound email.
  storedBytes: integer('stored_bytes').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_form_submissions_form').on(t.formId),
  index('idx_form_submissions_site').on(t.siteId),
  index('idx_form_submissions_form_status').on(t.formId, t.status),
])

// Type definitions for form field schema
export interface FormField {
  id: string
  // 'step' isn't a question: it starts a new page of a multi-step form, its label the page's heading.
  type: 'text' | 'email' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number' | 'date' | 'file' | 'computed' | 'hidden' | 'signature' | 'step'
  label: string
  name: string
  placeholder?: string
  required?: boolean
  options?: Array<{ label: string; value: string }>
  validation?: Record<string, unknown>
  formula?: string
  /** Show this field only when an earlier answer matches (apps/nuxflow/shared/lib/form-logic.ts). */
  showIf?: { field: string; op: 'equals' | 'not_equals' | 'contains' | 'filled' | 'empty'; value?: string } | null
}
