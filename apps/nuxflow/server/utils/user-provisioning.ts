import type { H3Event } from 'h3'
import { ulid } from 'ulid'
import { useDb } from './db'
import { getOrCreateBetterAuth } from './better-auth'

// Creates a user account with an unusable random temp password if one doesn't already
// exist for this email, without ever sending that password anywhere — callers are
// expected to follow up with auth.api.requestPasswordReset() to give the person a real,
// working way in (see server/api/v1/users/index.post.ts's own comment on why that's the
// *only* email a brand-new account should get, not a separate dead-end "you've been
// invited" email). Shared by the invite flow and per-site backup restore
// (server/utils/backup.ts), which both need "find this email, or create a fresh account
// for it" — restoring a backup onto a brand-new deployment means none of the original
// site's users exist there yet, so restore has the exact same provisioning need invite does.
export async function findOrCreateUserAccount(
  event: H3Event,
  { name, email }: { name: string; email: string },
): Promise<{ userId: string; isNewAccount: boolean }> {
  // Better Auth's own sign-up endpoint normalizes email to lowercase before inserting
  // (see register.post.ts, which already lowercases for this exact reason) — matching
  // that here up front means both lookups below actually find the row it creates,
  // instead of 500ing on any invitee email containing an uppercase letter.
  const normalizedEmail = email.toLowerCase()
  const db = useDb(event)
  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, normalizedEmail),
    columns: { id: true },
  })
  if (existing) return { userId: existing.id, isNewAccount: false }

  const auth = await getOrCreateBetterAuth(event)
  const tempPassword = ulid()
  await auth.api.signUpEmail({ body: { name, email: normalizedEmail, password: tempPassword } })

  const created = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, normalizedEmail),
    columns: { id: true },
  })
  if (!created) throw createError({ statusCode: 500, message: 'Failed to create user account' })
  return { userId: created.id, isNewAccount: true }
}
