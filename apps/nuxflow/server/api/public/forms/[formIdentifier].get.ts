import { useDb } from '../../../utils/db'
import { getFormBySlugOrThrow } from '../../../utils/resource-queries'
import { notFound } from '../../../utils/response'
import type { FormField } from '@nuxflow/db/schema'

// Public, unauthenticated: returns only what's needed to render a Form Builder
// form on a page (Canvas "dynamic-form/form" block) — never the notifications
// config, logic rules, or any other internal/admin-only field.
export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404 })

  const db = useDb(event)
  const formIdentifier = getRouterParam(event, 'formIdentifier')!

  const form = await getFormBySlugOrThrow(db, siteId, formIdentifier, 'Form not found')
  if (form.status !== 'active') notFound('Form not found')

  const fields = (form.fields as FormField[]).map(f => ({
    id: f.id,
    type: f.type,
    label: f.label,
    name: f.name,
    placeholder: f.placeholder,
    required: f.required,
    options: f.options,
    // Only 'computed' fields need their formula on the client to render a value.
    formula: f.type === 'computed' ? f.formula : undefined,
  }))

  return { id: form.id, name: form.name, fields }
})
