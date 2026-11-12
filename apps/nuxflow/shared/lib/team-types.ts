// What Admin → Users gets from the server: GET /api/v1/users (the site's people) and what
// inviting or re-sending an invite says about the email. Import-free apart from the role list.
import type { Role } from '@nuxflow/db/roles'

/** Did the email go out? `reason` is shown to the admin when it didn't. */
export type EmailDeliveryOutcome = { sent: true } | { sent: false; reason: string }

/** Someone with a role on the site, or invited to one. */
export interface SiteUser {
  id: string
  name: string
  email: string
  image: string | null
  createdAt: string
  role: Role
  /** Invited but never signed in. */
  pending: boolean
  /** Set for an invitation not yet accepted. */
  invitationExpiresAt?: string
}

export interface SiteUsersResponse {
  users: SiteUser[]
}
