import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

export const forms = sqliteTable('forms', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  fields: text('fields', { mode: 'json' }).$type<FormField[]>().notNull().default([]),
  logic: text('logic', { mode: 'json' }).$type<ConditionalLogic[]>().notNull().default([]),
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
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_form_submissions_form').on(t.formId),
  index('idx_form_submissions_site').on(t.siteId),
])

// Type definitions for form field schema
export interface FormField {
  id: string
  type: 'text' | 'email' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number' | 'date' | 'file' | 'computed' | 'hidden'
  label: string
  name: string
  placeholder?: string
  required?: boolean
  options?: Array<{ label: string; value: string }>
  validation?: Record<string, unknown>
  formula?: string
}

export interface ConditionalLogic {
  fieldId: string
  action: 'show' | 'hide' | 'require'
  conditions: Array<{
    fieldId: string
    operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than'
    value: unknown
  }>
  logicType: 'all' | 'any'
}
