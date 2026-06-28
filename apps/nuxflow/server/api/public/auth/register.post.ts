import { z } from 'zod'
import { users, accounts, userSiteRoles } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { nuxflowPasswordHasher } from '../../../utils/pw'
import { useDb } from '../../../utils/db'
import { resolveSetting } from '../../../utils/settings'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const registrationEnabled = await resolveSetting(event, 'auth.allow_public_registration')
  if (registrationEnabled !== 'true') {
    throw createError({ statusCode: 403, message: 'Public registration is not enabled for this site' })
  }

  const db = useDb(event)
  const email = body.email.toLowerCase()

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  })

  if (existing) {
    throw createError({ statusCode: 422, message: 'An account with this email already exists' })
  }

  // Create user and credential account directly — same approach as the setup wizard.
  // A self-referencing fetch() to Better Auth's sign-up endpoint times out on
  // Cloudflare Workers (error 522) because a Worker cannot await a subrequest to itself.
  const userId = ulid()
  const passwordHash = await nuxflowPasswordHasher.hash(body.password)

  await db.insert(users).values({
    id: userId,
    name: body.name,
    email,
    emailVerified: false,
  })

  await db.insert(accounts).values({
    id: ulid(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
  })

  await db.insert(userSiteRoles)
    .values({ id: ulid(), userId, siteId, role: 'member' })
    .onConflictDoNothing()

  return { success: true }
})
