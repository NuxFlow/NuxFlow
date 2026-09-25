---
"@nuxflow/app": minor
---

fix: close auth, tenancy, XSS, and CSRF gaps found in a full security sweep

**Authentication**
- Auth rate limits are matched on the path without its query string — `?anything` previously skipped every limit on sign-in, sign-up, and password reset.
- Better Auth's own `POST /api/auth/sign-up/email` is blocked; it ignored the per-site registration setting. Invites and backup restores now reclaim an existing account whose email was never verified and that holds no staff role anywhere (sessions and passkeys revoked, password reset) before granting it a role, so a pre-registered address can't capture an invite. Completing a password reset now marks the email verified.
- The setup wizard requires an existing account's current password (checked before the one-time token is consumed).

**Multi-tenant boundaries**
- Completing a secondary site's setup link grants `admin`, not platform-wide `super_admin`.
- `requireSuperAdmin` now requires a `super_admin` grant on the site the request arrived on, so script on a tenant's domain can't use a visiting operator's session for platform actions. **Existing deployments:** review `super_admin` grants on secondary sites created before this change and downgrade tenant owners to `admin`.

**Content permissions**
- Authors can only edit their own items while in draft or review, and can only set those statuses (REST and MCP); the editor shows a read-only notice otherwise.

**XSS / sandboxing**
- Theme CSS escapes every `<`, so no `</style` variant can break out of the injected style block.
- The SVG upload sanitizer was rewritten (fixed-point, namespace-aware, entity-decoded URL checks, DOCTYPE/ENTITY/xml-stylesheet removal); MIME parameters no longer skip it, and R2/S3 store SVGs as attachments.
- Plugin frames carry a CSP `sandbox` even when opened directly; plugin server responses are forced into a sandbox with `Set-Cookie` stripped.

**Other**
- CSRF: cookie-bearing cross-origin POST/PUT/PATCH/DELETE to `/api/**` is rejected (covers same-site sibling subdomains that SameSite=Lax doesn't).
- Page cache skips requests with an `Authorization` header; comments require a published item with comments enabled; `sourceItemId` must be same-site; Paddle webhooks enforce a 5-minute replay window; membership return URLs must be same-host http(s).
- Draft preview links now work (and use the site's own domain); API key `lastUsedAt` is recorded.
