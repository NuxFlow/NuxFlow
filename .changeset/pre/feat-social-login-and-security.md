---
"@nuxflow/app": minor
"@nuxflow/db": patch
---

Add social login (Google/GitHub) with account linking, fix OAuth account-insert schema gap, and apply security hardening.

**Social login & account linking**
- `auth.config.ts`: fix `accountLinking` config key path (`accountLinking` → `account.accountLinking`) so `trustedProviders` is actually read by Better Auth; add `requireLocalEmailVerified: false` so onboarding-created admins can auto-link without email verification
- `setup/complete.post.ts`: set `emailVerified: true` for the onboarding admin user (they proved ownership by running the wizard)
- New `AdminLinkedAccountsManager.vue` component: shows email/password and OAuth provider rows, connect/disconnect buttons, safety guard against removing last auth method
- `admin/settings/index.vue`: add LinkedAccountsManager to Security tab; deep-link to tab via `?tab=` query param after OAuth callback
- `login.vue` and `register.vue`: handle `?error=` query params from Better Auth OAuth callbacks with user-friendly messages; add Google/GitHub buttons to register page

**DB schema fix**
- `packages/db/src/schema/users.ts`: add `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope` columns to the `accounts` table — Better Auth v1.6.14 inserts these on every OAuth account creation; their absence caused `unable_to_link_account` on first Google sign-in
- Migration `0004_faithful_centennial.sql`: three nullable `ALTER TABLE ADD COLUMN` statements applied automatically on next deploy

**Security hardening**
- `theme-resolver.ts`: strip `</style>` tags from KV-stored CSS before SSR injection
- `site-settings-resolver.ts`: validate primary colour against CSS allowlist regex; restrict font to known-good allowlist before injecting Google Fonts link
- `03.api-key-auth.ts`: scope API key lookup to `event.context.siteId` so keys from one site cannot authenticate against another
- `mcp.ts`: add role checks to `create_content` and `update_content` tools (author+ to create, editor+ to publish)
- `comments.get.ts`: strip `guestEmail` from public comment responses
- `preview/[token].get.ts`: query by `previewToken` column instead of `id`; add `siteId` scope and expiry check
- `seed-test-pages.get.ts`: restrict to `NODE_ENV=development` and require super admin auth

**Docs**
- `docs/installation.md`: Social Login section with step-by-step Google and GitHub OAuth setup, required secrets, callback URIs, build-time env var reminder
- `docs/user-guide.md`: Social Login & Account Linking section covering new-user signup, post-onboarding auto-linking, manual linking from Settings, and error message reference
