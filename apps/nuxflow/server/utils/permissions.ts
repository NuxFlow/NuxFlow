import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from './db'

export type Role = 'super_admin' | 'admin' | 'editor' | 'author' | 'viewer' | 'member'

const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  editor: 60,
  author: 40,
  member: 20,
  viewer: 10,
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

export async function requireAuth(event: H3Event): Promise<{ userId: string; role: Role }> {
  const session = await requireUserSession(event)

  const siteId = event.context.siteId
  if (!siteId) throw createError({ statusCode: 400, message: 'Unknown site' })

  const db = useDb(event)
  const roleRow = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, session.user.id), eq(userSiteRoles.siteId, siteId)),
  })

  return { userId: session.user.id, role: (roleRow?.role ?? 'viewer') as Role }
}

export async function requireRole(event: H3Event, minimum: Role) {
  const { userId, role } = await requireAuth(event)
  if (!roleAtLeast(role, minimum)) throw createError({ statusCode: 403, message: 'Forbidden' })
  return { userId, role }
}

export async function requireSuperAdmin(event: H3Event): Promise<{ userId: string }> {
  const session = await requireUserSession(event)

  const db = useDb(event)
  const roleRow = await db.query.userSiteRoles.findFirst({
    where: and(
      eq(userSiteRoles.userId, session.user.id),
      eq(userSiteRoles.role, 'super_admin'),
    ),
  })

  if (!roleRow) throw createError({ statusCode: 403, message: 'Super admin required' })
  return { userId: session.user.id }
}
