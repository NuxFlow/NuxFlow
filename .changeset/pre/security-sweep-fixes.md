---
"@nuxflow/app": minor
"@nuxflow/canvas": patch
"@nuxflow/cli": patch
---

fix: close 8 vulnerabilities found in a full-codebase security sweep

**Authorization**
- `PATCH /api/v1/users/:id` no longer lets an `admin` demote or reassign a `super_admin`'s role on that site — the guard already present on the equivalent `DELETE` route was missing here.
- `POST`/`PATCH /api/v1/content` now require `editor`+ to set `status: 'published'`/`'scheduled'` directly — an `author` (the floor for content-write access) was previously able to self-publish unreviewed content, matching the guard already enforced for the MCP `update_content` tool.

**Dynamic plugins**
- The `/_nuxflow/ext/{pluginId}/*` proxy now forwards only an explicit allowlist of headers to plugin Workers (Content-Type, Accept, etc.) instead of the full incoming header set — it previously forwarded `Cookie`/`Authorization` verbatim to third-party plugin code, which only needs a self-signed Ed25519 key to install.
- The Worker Loader cache key now includes `siteId` — two unrelated tenants installing byte-identical plugin code could previously share the same spawned Worker instance (and whatever in-memory state a prior request left behind).

**Canvas / stored XSS**
- Added `safeHref()` (scheme allowlist, matching the existing `javascript:`/`vbscript:`/`data:` guard in `render-tiptap.ts`) and wired it into every link-bearing block prop (Button, Hero, CTA, Footer, Pricing, GDPR banner, Calendar) — these bound straight to `:href` with no scheme validation, unlike the `richtext`/`html` fields which already went through an XSS-filter sanitizer.

**Payments**
- New `assertWebhookSiteMatch()` — every Stripe/LemonSqueezy/Paddle webhook must now carry a `siteId`/`site_id` in its signed payload metadata matching the site the request resolved to (via the `Host` header) before any subscription row is written or cancelled. A valid provider signature only proves the payload came from that provider using *some* site's configured secret, not which tenant it was meant for; two sites sharing a provider account/secret could previously have a webhook meant for one site applied to whichever site the request's Host header resolved to.

**Theme CSS**
- `sanitizeThemeCss` now decodes CSS escape sequences (`\75rl(...)` → `url(...)`) before stripping `url()`/`@import`/`expression()` — closes an escape-based bypass of the CSS attribute-selector exfiltration guard.

**CLI**
- `nuxflow plugin/theme deploy --site <url>` now refuses a non-`https://` site URL (except localhost/loopback) — it previously sent the admin email/password/session cookie in the clear over whatever scheme was given.
