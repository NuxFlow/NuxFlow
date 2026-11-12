import { and, eq } from 'drizzle-orm'
import { contentTypes } from '@nuxflow/db/schema'
import type { Db } from './db'
import { validationError } from './response'
import { normalizeFieldValues, parseFieldDefs, type CustomFieldDef, type CustomFieldValues } from '../../shared/lib/custom-fields'

/**
 * Custom fields on content types (Admin → Content types): definitions in
 * `content_types.schema.fields`, an item's values in `content_items.fields`. The rules are in
 * shared/lib/custom-fields.ts; this is the server's side of reading and checking them.
 */

export async function fieldDefsForType(db: Db, siteId: string, typeId: string): Promise<CustomFieldDef[]> {
  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.id, typeId), eq(contentTypes.siteId, siteId)),
    columns: { schema: true },
  })
  return parseFieldDefs(type?.schema)
}

/**
 * An item's values as sent by the editor, checked against its type's fields. Required fields
 * are only enforced when the item is being published — a draft can be saved half-filled.
 * Throws a 422 with the problem.
 */
export function checkFieldValues(defs: CustomFieldDef[], input: unknown, publishing: boolean): CustomFieldValues | null {
  let values: CustomFieldValues
  try {
    values = normalizeFieldValues(defs, input, { requireAll: publishing })
  }
  catch (err) {
    throw validationError(err instanceof Error ? err.message : 'These details aren\'t valid')
  }
  return Object.keys(values).length ? values : null
}
