import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  // Site columns
  name: z.string().min(1).max(100).optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  status: z.enum(['active', 'maintenance']).optional(),
  // Site settings (key-value store)
  settings: z.record(z.unknown()).optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const siteUpdate = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.locale !== undefined && { locale: body.locale }),
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.status !== undefined && { status: body.status }),
  }

  if (Object.keys(siteUpdate).length > 0) {
    await db.update(sites)
      .set({ ...siteUpdate, updatedAt: sql`(datetime('now'))` })
      .where(eq(sites.id, siteId))
  }

  if (body.settings) {
    for (const [key, value] of Object.entries(body.settings)) {
      const existing = await db.query.siteSettings.findFirst({
        where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
      })
      if (existing) {
        await db.update(siteSettings)
          .set({ value, updatedAt: sql`(datetime('now'))` })
          .where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)))
      } else {
        await db.insert(siteSettings).values({ id: ulid(), siteId, key, value })
      }
    }
  }

  return { success: true }
})
