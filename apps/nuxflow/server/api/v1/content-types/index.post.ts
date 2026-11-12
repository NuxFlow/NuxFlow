import { z } from 'zod'
import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { conflict, created, forbidden, notFound, validationError } from '../../../utils/response'
import { purgeAllPublicPages } from '../../../utils/edge-cache'
import { waitUntil } from '../../../utils/cf-env'
import { fieldDefsProblem, parseFieldDefs } from '../../../../shared/lib/custom-fields'

// Admin → Content types. One POST with an `action`, not a route per action: each new route
// address adds to the generated route types, and one more tipped `nuxt typecheck` into
// TS2589 (CLAUDE.md, the same reason the Starter sites API is a single POST).
const bodySchema = z.discriminatedUnion('action', [
  // A new kind of content (properties, menu items, team members) with its own fields.
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1, 'Give it a name, e.g. Properties').max(60),
    singularName: z.string().trim().min(1, 'Give one of them a name, e.g. Property').max(60),
    slug: z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Use lower-case letters, numbers and hyphens, e.g. property'),
  }),
  // Renames a type or changes its fields. Removing a field leaves the values already saved
  // on items alone (they stop showing); adding it back brings them back.
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60).optional(),
    singularName: z.string().trim().min(1).max(60).optional(),
    fields: z.array(z.unknown()).optional(),
  }),
  // Deletes a type the site made, once nothing uses it (items cascade from their type).
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
])

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)

  if (body.action === 'create') {
    const taken = await db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, body.slug)), columns: { id: true } })
    if (taken) throw conflict('There is already a content type with that key.')
    const id = ulid()
    await db.insert(contentTypes).values({
      id,
      siteId,
      slug: body.slug,
      name: body.name,
      singularName: body.singularName,
      icon: 'i-lucide-layout-list',
      isBuiltIn: false,
      hasRevisions: true,
      hasComments: false,
      schema: { fields: [] },
    })
    await writeAuditLog(event, userId, { action: 'create', resource: 'content_type', resourceId: id, after: { slug: body.slug, name: body.name } })
    return created(event, { id })
  }

  const scope = and(eq(contentTypes.id, body.id), eq(contentTypes.siteId, siteId))
  const type = await db.query.contentTypes.findFirst({ where: scope })
  if (!type) throw notFound('Content type not found')

  if (body.action === 'delete') {
    if (type.isBuiltIn) throw forbidden('Built-in content types can\'t be deleted.')
    const used = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, siteId), eq(contentItems.typeId, type.id)), columns: { id: true } })
    if (used) throw conflict(`This type still has ${type.name.toLowerCase()}. Delete them first.`)
    await db.delete(contentTypes).where(scope)
    await writeAuditLog(event, userId, { action: 'delete', resource: 'content_type', resourceId: type.id, before: { slug: type.slug, name: type.name } })
    return { success: true }
  }

  const update: Partial<typeof contentTypes.$inferInsert> = {}
  if (body.name) update.name = body.name
  if (body.singularName) update.singularName = body.singularName
  if (body.fields) {
    const problem = fieldDefsProblem(body.fields)
    if (problem) throw validationError(problem)
    update.schema = { ...(type.schema ?? {}), fields: parseFieldDefs({ fields: body.fields }) }
  }
  if (!Object.keys(update).length) return { success: true }
  await db.update(contentTypes).set(update).where(scope)
  await writeAuditLog(event, userId, { action: 'update', resource: 'content_type', resourceId: type.id, after: update })
  // Every page of this type lists its details.
  waitUntil(event, purgeAllPublicPages(event, siteId).catch(err => console.error('[content-types] Cache purge failed:', err)))
  return { success: true }
})
