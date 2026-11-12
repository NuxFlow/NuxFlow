import { sql, type SQL } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import type { CustomFieldDef } from '../../shared/lib/custom-fields'
import type { FilterableType, PublicFilterDef } from '../../shared/lib/listing-types'

/**
 * Filtering and sorting public listings by a content type's custom fields — only fields the
 * admin marked "Use as a filter on listings". The query string carries them as:
 *
 *   f.<key>.min / f.<key>.max   a number field's range        f.price.max=300000
 *   f.<key>=<choice>            one-choice field              f.kind=House
 *   f.<key>=<a>,<b>             several-choices: has all of   f.amenities=Parking,Garden
 *   f.<key>=1                   yes/no field is yes           f.garden=1
 *   sort=f.<key> | -f.<key>     a number field, low or high first
 *
 * Unknown keys and unusable values are ignored rather than refused, so an old shared link
 * still lists something. Keys are checked against the definitions (lower-case letters,
 * digits and underscores) before they reach a JSON path, and every value is a bound
 * parameter.
 */

export type { FilterableType, PublicFilterDef }
const FILTERABLE_TYPES = new Set<string>(['number', 'boolean', 'select', 'multiselect'])

/** The filters a listing of this type offers, for the Posts block's controls. */
export function publicFilterDefs(defs: CustomFieldDef[]): PublicFilterDef[] {
  return defs
    .filter(d => d.filterable && FILTERABLE_TYPES.has(d.type))
    .map(d => ({
      key: d.key,
      label: d.label,
      type: d.type as FilterableType,
      ...(d.options ? { options: d.options } : {}),
      ...(d.prefix ? { prefix: d.prefix } : {}),
      ...(d.suffix ? { suffix: d.suffix } : {}),
    }))
}

const path = (key: string) => `$.${key}`

/** WHERE conditions for the `f.*` parameters that match a filterable field. */
export function fieldFilterConditions(defs: CustomFieldDef[], params: Record<string, string>): SQL[] {
  const conditions: SQL[] = []
  for (const def of publicFilterDefs(defs)) {
    const value = (suffix = '') => params[`f.${def.key}${suffix}`]?.trim() ?? ''
    const extract = sql`json_extract(${contentItems.fields}, ${path(def.key)})`
    switch (def.type) {
      case 'number': {
        const min = Number(value('.min'))
        const max = Number(value('.max'))
        if (value('.min') && Number.isFinite(min)) conditions.push(sql`CAST(${extract} AS REAL) >= ${min}`)
        if (value('.max') && Number.isFinite(max)) conditions.push(sql`CAST(${extract} AS REAL) <= ${max}`)
        break
      }
      case 'boolean':
        // JSON true reads back from json_extract() as 1.
        if (value() === '1' || value() === 'true') conditions.push(sql`${extract} = 1`)
        break
      case 'select':
        if (value() && def.options?.includes(value())) conditions.push(sql`${extract} = ${value()}`)
        break
      case 'multiselect': {
        const wanted = value().split(',').map(v => v.trim()).filter(v => def.options?.includes(v)).slice(0, 20)
        for (const option of wanted) {
          conditions.push(sql`EXISTS (SELECT 1 FROM json_each(${contentItems.fields}, ${path(def.key)}) WHERE json_each.value = ${option})`)
        }
        break
      }
    }
  }
  return conditions
}

/** ORDER BY for `sort=f.<key>` (low first) or `-f.<key>` (high first); items without a value last. */
export function fieldSortOrder(defs: CustomFieldDef[], sort: string | undefined): SQL[] | undefined {
  const m = /^(-)?f\.([a-z][a-z0-9_]{0,39})$/.exec(sort ?? '')
  if (!m) return undefined
  const def = publicFilterDefs(defs).find(d => d.key === m[2] && d.type === 'number')
  if (!def) return undefined
  const extract = sql`json_extract(${contentItems.fields}, ${path(def.key)})`
  return [sql`${extract} IS NULL`, m[1] ? sql`CAST(${extract} AS REAL) DESC` : sql`CAST(${extract} AS REAL) ASC`]
}
