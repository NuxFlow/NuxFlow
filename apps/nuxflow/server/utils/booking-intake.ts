import { and, eq } from 'drizzle-orm'
import { contentItems, forms } from '@nuxflow/db/schema'
import type { Db } from './db'
import { publicFormField } from './form-submission'

/**
 * An event's intake form: a Form Builder form (a health waiver, a questionnaire) a visitor
 * fills in on the event page before their booking goes through. Chosen per event in the
 * editor and kept in the event's `settings.intakeFormId`; a translated event uses its
 * original's, like its booking list. The answers are saved as an ordinary submission of that
 * form, so they land in its inbox, notify and reach plugins like any other.
 */

export const INTAKE_SETTING = 'intakeFormId'

type FormRow = typeof forms.$inferSelect

/** The event's intake form, when it has one that's active. */
export async function getIntakeForm(db: Db, siteId: string, itemId: string): Promise<FormRow | null> {
  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, itemId), eq(contentItems.siteId, siteId)),
    columns: { settings: true },
  })
  const formId = (item?.settings as Record<string, unknown> | null)?.[INTAKE_SETTING]
  if (typeof formId !== 'string' || !formId) return null
  const form = await db.query.forms.findFirst({ where: and(eq(forms.id, formId), eq(forms.siteId, siteId)) })
  return form?.status === 'active' ? form : null
}

/**
 * The questions asked on the event page. File uploads aren't offered there (a booking is a
 * plain JSON request, and a waiver doesn't need them), so file fields are left out — and
 * so never required.
 */
export function intakeFields(form: FormRow) {
  return form.fields.filter(f => f.type !== 'file')
}

export function publicIntakeForm(form: FormRow) {
  return { name: form.name, fields: intakeFields(form).map(publicFormField) }
}
