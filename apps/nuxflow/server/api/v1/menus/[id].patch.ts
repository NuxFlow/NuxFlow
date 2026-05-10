import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { menus } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const menuItemSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['page', 'url']),
    url: z.string().optional(),
    contentId: z.string().optional(),
    slug: z.string().optional(),
    target: z.enum(['_self', '_blank']).default('_self'),
    children: z.array(z.object({
      id: z.string(),
      label: z.string(),
      type: z.enum(['page', 'url']),
      url: z.string().optional(),
      contentId: z.string().optional(),
      slug: z.string().optional(),
      target: z.enum(['_self', '_blank']).default('_self'),
    })).default([]),
  }),
)

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.enum(['header', 'footer', 'sidebar']).nullish(),
  items: z.array(menuItemSchema).optional(),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const existing = await db.query.menus.findFirst({
    where: and(eq(menus.id, id), eq(menus.siteId, siteId)),
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, message: 'Menu not found' })

  await db.update(menus)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...('location' in body && { location: body.location ?? null }),
      ...(body.items !== undefined && { items: body.items as unknown[] }),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(and(eq(menus.id, id), eq(menus.siteId, siteId)))

  return { ok: true }
})
