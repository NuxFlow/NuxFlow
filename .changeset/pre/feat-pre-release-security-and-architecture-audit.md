---
"@nuxflow/app": minor
"@nuxflow/canvas": patch
"@nuxflow/db": patch
---

feat: pre-release security, correctness, and Cloudflare-native architecture audit

A full audit pass across the codebase before first release, covering security, payments correctness, data integrity, and making better use of Cloudflare-native primitives. Grouped by area:

**Security**
- `02.multi-site.ts`'s domain self-heal (auto-updates a site's stored domain to match the live request host) now requires an authenticated admin+ session on that site — previously any unauthenticated request to `/admin/*` with a forged `Host` header could silently hijack a site's domain on a Worker with no custom-domain route configured.
- `setup/complete.post.ts`'s secondary-site token claim is now one atomic conditional `UPDATE ... WHERE setupTokenHash = ?` instead of a read-then-write — closes a race where two concurrent requests holding the same (e.g. leaked) token could both become `super_admin`.
- New `safeFetch()` / `resolvesToPrivateIp()` in `security.ts` — resolves a URL's hostname via DNS-over-HTTPS and re-validates on every redirect hop before the WordPress importer or backup media-fetch paths touch it, closing a DNS-rebinding gap in `isSafeUrl()` (which only inspected the literal hostname string).
- `00.migrate.ts`'s migration-lock loser now polls for the winner to actually finish (bounded) instead of assuming success after ~1s and serving requests against a possibly-unmigrated schema.
- `exif.ts`'s accessor helpers (`rational`/`getShort`/`getLong`/`getRational`) are now bounds-checked by construction — previously safe only because the one caller happened to wrap the call in try/catch.

**Payments correctness**
- The public content gate now requires `currentPeriodEnd > now()` in addition to `status = 'active'` — access no longer outlives a stalled or dropped webhook (a failed card during dunning used to leave full access indefinitely).
- `upsertSubscriptionFromWebhook` is now one atomic `INSERT ... ON CONFLICT DO UPDATE`, backed by a new unique index on `subscriptions(site_id, provider, provider_subscription_id)` — closes a race where two webhook deliveries for the same checkout (Stripe always sends both `checkout.session.completed` and `customer.subscription.created`) could create duplicate subscription rows and double-send the activation push.
- Stripe's secondary subscription-details fetch now throws (502) instead of silently swallowing a failure and returning 200 — Stripe will retry a transient failure properly now instead of it being lost.

**Rate limiting**
- Replaced the two-tier (isolate-memory + KV-or-D1 read-then-write) rate limiter with a single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` against D1 — closes a TOCTOU race where concurrent requests for the same key could all read the same pre-increment count before any write landed, letting the effective limit be exceeded by roughly the number of in-flight requests every window. Isolate memory is now purely a fast-fail cache for already-confirmed-blocked keys, not the source of truth.

**Cloudflare-native architecture**
- New `R2Provider` (`media-providers/r2.ts`) — Cloudflare's own object storage, zero egress fees, no third-party account, accessed via an optional `MEDIA_BUCKET` bucket binding. Slotted into `getActiveProvider()`'s priority chain right after Cloudflare Images. Configurable in Settings → Media.
- Theme CSS is now stored under a versioned KV key (`themes.cssVersion`, bumped atomically on every publish) instead of a fixed one — closes a staleness window where a publish could take up to ~2 minutes to become visible everywhere, from isolate-local CSS caching compounding with KV's own eventual-consistency propagation lag. Includes a backward-compatible fallback to the pre-versioning key so themes published before this change don't go dark.
- The dynamic-plugin WorkerLoader cache key is now the plugin's stored code checksum instead of its free-text version string — a code-only fix shipped via `nuxflow plugin update` without a version bump now actually takes effect instead of continuing to serve stale cached code.
- New hourly `reconcile-stuck-videos` task sweeps `video_assets` rows stuck at `status: 'processing'` past a 2-hour TTL; the video registration endpoint now requires a real successful Cloudflare Stream lookup before inserting a row at all, instead of silently inserting one that could never leave that state.

**Data integrity**
- New unique index on `content_taxonomy_terms(content_item_id, term_id)` — nothing previously stopped a duplicate assignment from double-counting an item in taxonomy archives.
- `rate_limits` and `notifications` are now swept by the nightly `prune-old-data` task (previously unbounded).
- Content autosave no longer snapshots a revision when title/content didn't actually change; `GET .../revisions` is now capped at 50 results.
- Backup/restore now routes settings through `saveSetting()` (fixes stale-cache and broken re-encryption-on-restore bugs from bypassing it) and batches the content-restore existence checks into one query instead of one per item.
- `sitemap.xml` / `sitemap-images.xml` are now bounded instead of unbounded.
- The FTS5 `search_index` update trigger now only fires its reindex on the columns that actually affect it (title/excerpt/status/visibility), instead of on every single content edit.
- Fire-and-forget notifications in `contact/submit` and `content/[id].patch` now use `ctx.waitUntil()` instead of risking silent cancellation when the isolate is reused before they finish.

**Frontend bundle size**
- The admin page-builder editor (`CanvasContentEditor`, pulling in `vuedraggable` and friends) is now a lazy async component instead of shipping to every public-page visitor via a universal client plugin.
- `highlight.js` (core + 11 language grammars) now loads only when a page actually has a code block, instead of eagerly on every navigation.
- `CanvasBlockImage` now lazy-loads, matching its `CanvasBlockGallery` sibling.
- `feed.xml`'s hand-rolled TipTap serializer now blocks `javascript:`/`vbscript:`/`data:` URL schemes in links and images, matching the sanitization the canonical web renderer already had — closes a gap where a malicious link/image URL was neutralized on the page but passed through unmodified into the RSS feed.

**Also fixed**: a block-registry regression introduced (and caught before release) during this same pass, where a collision guard meant to stop a plugin from squatting a built-in block id also rejected the built-ins' own bootstrap registration — every block on every page fell back to its loading skeleton. `register()` now only rejects an id that's *already* registered, relying on built-ins always registering first (synchronously, at boot) to win that race.
