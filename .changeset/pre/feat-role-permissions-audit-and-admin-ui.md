---
"@nuxflow/app": minor
---

feat: role/permissions security audit — close cross-tenant access gaps, add admin UI role gating, super admin management, and whole-database export

**Authorization (security)**
- `requireAuth()` now rejects a user with no role row on the current site (403) instead of silently granting a default `'viewer'` — user accounts are global across a multi-tenant install (no `siteId` on `users`/`accounts`) and login has no site-membership check, so any account anywhere in the instance could previously get baseline read access to another site's admin data (drafts, private/members-only content, media library, revisions) just by authenticating on that site's domain. Super admins keep their documented cross-site `'viewer'` fallback; only genuine strangers are rejected.
- The same gap existed in API-key auth: removing a user from a site only deletes their `user_site_roles` row, not their API keys, so a revoked user's still-valid key kept working at `'viewer'` level indefinitely. `03.api-key-auth.ts` now leaves the key unresolved (same as an unrecognized one) when its owner's role row is gone, instead of defaulting to `'viewer'`.
- All 7 AI generation routes (`generate-content`, `generate-canvas`, `improve`, `grammar`, `seo-suggest`, `translate`, `alt-text`) required only a valid session — any authenticated user, including a self-registered `'member'`, could burn provider API spend. Now require `'editor'`, matching the two sibling AI routes that already did.
- All 3 menu mutation routes (create/update/delete) required only a valid session — any authenticated user could edit site navigation, including the header/footer, and trigger a full public-page cache purge. Now require `'editor'`, matching every other content-mutation route.
- `PATCH /api/v1/users/:id` blocked an admin from touching a super admin's role but not their own — an admin could self-demote with no confirmation, and if they were the site's last admin, no recovery path short of a super admin from another site. Blocked, mirroring the existing DELETE guard; the role dropdown is also disabled for your own row in the UI now.

**Admin UI**
- New client-side role gating: `app/utils/admin-nav.ts` is the shared source of truth for each section's minimum role, consumed by the sidebar (hides links a role can't use) and a new global route guard (redirects direct navigation to a friendly `/admin/forbidden` page instead of a silent failure).
- New `POST`/`DELETE /api/v1/users/:id/super-admin` — promote/revoke a super admin without running someone through the full site-setup wizard (which also reseeds the site's content as a side effect).
- `GET /api/v1/users` now reports a `pending` flag (never logged in) per user; `POST /api/v1/users/:id/resend-invite` re-sends the set-password email.
- Self-registration now triggers a best-effort verification email (send capability wired up, not yet enforced — no `requireEmailVerification` flag, since every existing account in every existing deployment has `emailVerified=false` and a hard block would lock out current users the moment this ships).

**New: whole-database SQL export**
- `GET /api/v1/admin/db-export` (Admin → Super Admin → Database) generates a standalone, restorable `.sql` dump of every table across every site in the D1 instance — `wrangler d1 export` is CLI-only and unreachable from a live Worker, so this reimplements the idea via `sqlite_master`/`PRAGMA` introspection. Gated by `requireSuperAdmin`, not the site-scoped `requireRole` the per-site backup uses.

**Per-site backup**
- Theme CSS and dynamic plugin code — previously KV-only, silently missing from the JSON backup — are now included and restored (plugin code is re-verified by checksum + signature + trust pinning on restore, and a plugin id collision with another site's install now skips cleanly instead of crashing on a raw SQL constraint error).
