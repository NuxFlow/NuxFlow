import { z } from 'zod'
import { users, accounts, userSiteRoles } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { nuxflowPasswordHasher } from '../../../utils/pw'
import { useDb } from '../../../utils/db'
import { resolveSetting } from '../../../utils/settings'
import { rateLimit } from '../../../utils/rate-limit'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

export default defineEventHandler(async (event) => {
  // This route creates a user + credential account directly rather than going through
  // Better Auth's own /api/auth/sign-up/email handler (see the comment below on why), which
  // means it never passes through 04.auth-override.ts's per-path rate limiting either — that
  // limiter is keyed by exact request path and only ever sees "/api/auth/sign-up/email".
  // Mirror the same 5/hour-per-IP limit here so this parallel signup door isn't a completely
  // unthrottled way to mass-create accounts or enumerate existing emails via the check below.
  await rateLimit(event, { limit: 5, windowMs: 60 * 60_000, keyPrefix: 'public-register' })

  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const registrationEnabled = await resolveSetting(event, 'auth.allow_public_registration')
  if (registrationEnabled !== 'true') {
    throw forbidden('Public registration is not enabled for this site')
  }

  const db = useDb(event)
  const email = body.email.toLowerCase()

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  })

  if (existing) {
    throw validationError('An account with this email already exists')
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
    // Must match Better Auth's own createLocalAccountIssuer('credential') —
    // sign-in looks accounts up by (issuer, accountId), not providerId.
    issuer: 'local:credential',
    userId,
    password: passwordHash,
  })

  await db.insert(userSiteRoles)
    .values({ id: ulid(), userId, siteId, role: 'member' })
    .onConflictDoNothing()

  return { success: true }
})
