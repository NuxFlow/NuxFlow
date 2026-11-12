// What GET /api/v1/content-types sends (server/api/v1/content-types/index.get.ts): every
// content type with its custom fields. Read by Admin → Content types, the editor, the
// content list, and the type pickers in SEO, Podcast and Taxonomies. Import-free.
import type { CustomFieldDef } from './custom-fields'

export interface ContentTypeInfo {
  id: string
  slug: string
  name: string
  singularName: string
  isBuiltIn: boolean
  /** Custom fields (Admin → Content types). */
  fields: CustomFieldDef[]
  itemCount: number
}

export interface ContentTypesResponse {
  types: ContentTypeInfo[]
}
