# NuxFlow Roadmap & Future Features

This document tracks planned features and the preparatory groundwork already in place for them. It exists so that the reasoning behind certain schema or API decisions is not lost over time — some things were added early specifically to make a future feature easier.

---

## PWA & Offline Editing

### Vision

NuxFlow admins should be able to install the admin panel as a standalone app (via the browser's "Install app" option) and continue editing content drafts even without an internet connection. Changes made offline sync automatically when connectivity returns.

The public-facing site built on NuxFlow should also be installable as a PWA, with per-site configuration for app name, icon, and theme colour.

### Why this is interesting

- **Admin PWA**: Editors on mobile or a second screen get a native-feeling experience without a separate app build or app store submission.
- **Public site PWA**: Sites built on NuxFlow can be published to the Android Play Store via TWA (Trusted Web Activity) with minimal extra effort on top of a solid PWA.
- **True offline editing**: The content JSON is already self-contained in the DB — there is no reason an editor cannot queue changes locally and replay them when back online.

### Groundwork already in place

The following changes were made proactively to make the offline sync implementation straightforward when the time comes:

#### `version` column on `content_items`

(Present since `packages/db/migrations/0000_baseline.sql` — earlier revisions of this doc cited migration `0004`, which is stale after a schema-history squash; check the migrations folder directly rather than trusting a specific migration number here.)

Every content item now carries an integer `version` that is incremented on every `PATCH`. This enables **optimistic locking**:

- The client stores `version` alongside cached content in IndexedDB.
- On sync, the client includes `expectedVersion` in the `PATCH` request body.
- If the item was edited online while the user was offline, the server's version will be higher and it returns **HTTP 409 Conflict** with the current server version in the response body.
- The conflict resolution UI can then show the offline draft alongside the server version (using the existing `contentRevisions` history, which already snapshots before every save) and let the editor choose or merge.

Without this column, conflict detection would have to rely on `updatedAt` timestamps, which are unreliable under clock skew or same-second concurrent edits.

#### `updatedAfter` query parameter on `GET /api/v1/content`

The content list endpoint now accepts `?updatedAfter=<ISO8601 timestamp>`. An offline client that reconnects after a period away can call this once per content type to fetch only what changed — rather than re-downloading the entire content list.

This query hits the new `idx_content_items_site_updated` composite index on `(site_id, updated_at)`, so it remains fast even on large sites.

#### ULID IDs (already in place since the beginning)

All content items use ULID primary keys, which are time-sortable and can be generated client-side without a server round-trip. This means an editor creating a new post while offline can assign it a permanent ID locally — no temporary IDs that need to be swapped out on sync.

### What still needs to be built

When the feature is ready to implement, the remaining work is:

1. **`@vite-pwa/nuxt` integration** — service worker registration, `manifest.json` generation, and install prompt UI in the admin header.
2. **Caching strategy** — static assets (JS/CSS) served from the service worker cache; API calls use network-first with offline fallback.
3. **IndexedDB sync layer** — a composable (e.g. `useOfflineContent`) that mirrors the content store locally and queues mutations when offline.
4. **Conflict resolution UI** — a modal that surfaces when a 409 is returned on sync, showing the offline draft vs the server version with an option to keep either or view the diff.
5. **Dynamic `manifest.json` route** — reads app name, short name, icon, and theme colour from site settings so each NuxFlow-powered site gets its own installable identity.
6. **`/.well-known/assetlinks.json` route** — needed only if supporting Android TWA / Play Store publishing.

### What was explicitly ruled out

- **CRDTs (Yjs, Automerge)**: Appropriate for real-time collaborative editing where two users edit the same document simultaneously. For the offline case — one user, one device, reconnecting later — the version + revision approach above is simpler and sufficient.
- **Background Sync API**: The service worker Background Sync spec is still not supported on iOS Safari. A simpler approach (retry on `online` event) is more portable for a first implementation.
- **Electron / desktop wrappers**: NuxFlow is a cloud-hosted CMS; every meaningful operation requires a server round-trip. A native desktop wrapper adds 150 MB of Chromium for no functional benefit over an installed PWA.

---

## Cloudflare Analytics Engine

### Vision

NuxFlow sites should have first-party, cookie-free, GDPR-compliant page view and event analytics built in — no third-party scripts, no consent banners required for analytics alone, and no extra cost beyond the existing Cloudflare Workers Paid plan.

Editors get an Admin → Analytics dashboard showing page views, top pages, traffic by country, and referrer breakdown, all sourced directly from Cloudflare's edge network.

### Why this is valuable

- **Already included**: Analytics Engine is bundled with the Cloudflare Workers Paid plan ($5/month). There is no extra billing.
- **Cookie-free**: Analytics Engine stores aggregated data points, not individual user sessions. No cookies, no personal data, no GDPR consent requirement for page view tracking.
- **Edge-native and zero-latency**: `writeDataPoint()` is a fire-and-forget call on the same Worker request that serves the page. There is no separate tracking pixel, no DNS lookup, and no performance impact.
- **SQL queryable**: Cloudflare exposes Analytics Engine data via a SQL API, so custom queries (e.g. top 10 pages this week, views by country for a specific slug) are straightforward.

### Groundwork already in place

**`AnalyticsEngineDataset` binding type (added now)**

The `AnalyticsEngineDataset` interface has been added to `cloudflare-bindings.d.ts` and the `AE` binding is declared on `NuxFlowCloudflareEnv`. This means TypeScript is fully aware of the binding anywhere in the server codebase.

**`getAnalyticsEngine(event)` in `cf-env.ts` (added now)**

Follows the same pattern as `getCfBindings` — returns the `AE` binding when running on Cloudflare, `null` in local dev. All callers gracefully no-op when `null`.

**`trackPageView()` in `server/utils/analytics.ts` (added now)**

A fire-and-forget utility called at the end of every successful `GET /api/public/pages/:slug` response. It writes:

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| `blobs[0]`   | Page slug                                         |
| `blobs[1]`   | Visitor country (from `cf-ipcountry` header)      |
| `blobs[2]`   | Referrer URL (truncated to 256 chars)             |
| `doubles[0]` | `1` (page view count — SUM this in queries)       |
| `indexes[0]` | Site ID (partition key for fast per-site queries) |

Data collection starts the moment the `AE` binding is added to `wrangler.toml` — no code changes needed at that point.

**`wrangler.toml.example` binding (added now)**

The `[[analytics_engine_datasets]]` block is documented (commented out) in `wrangler.toml.example` so deployers know exactly what to add when they want analytics.

### What still needs to be built

1. **Activate the `AE` binding** — add `[[analytics_engine_datasets]]` to the live `wrangler.toml` (currently only in `.example`) and create the dataset in the Cloudflare dashboard.
2. **Analytics query server route** — `GET /api/v1/analytics/summary` calls the Cloudflare Analytics Engine SQL API via `fetch` (authenticated with a CF API token stored as a site setting), returning aggregated page view totals.
3. **Admin → Analytics dashboard** — charts (page views over time, top pages, country map, referrer list) built on top of the query route.
4. **Additional event types** — beyond page views: form submissions, paywall encounters, membership conversions. Each is one extra `trackPageView`-style utility call at the relevant server route.

### Enabling it

Once you have a Cloudflare Workers Paid plan, add to `wrangler.toml`:

```toml
[[analytics_engine_datasets]]
binding = "AE"
dataset = "nuxflow_analytics"
```

Then deploy. Page views start recording immediately. No code changes, no migrations.

---

## Cloudflare Workflows for long-running jobs

**What**: Move genuinely long-running, multi-step operations — WordPress WXR import, bulk AI alt-text generation, D1 whole-database export — off the single-request model and onto Workflows, which supports durable state, automatic per-step retries, and multi-hour execution.

**Why valuable**: The WordPress import route (see `MYSTUFF/Decide.txt`) already works around single-request limits with SSE streaming, but a very large WXR file still risks hitting Worker CPU/memory limits during its synchronous initial parse — the same class of problem the D1 export feature hit five separate times against real Cloudflare limits before landing on its current streaming design (see CLAUDE.md's "Backup, restore, and database export" section for the full account). Workflows sidesteps the whole category of "will this fit in one request" question.

**What still needs to be built**: picking one candidate (WordPress import is the best first target — it's already isolated behind a single route) and rewriting it as a Workflow with explicit steps (parse → upload media → create content), rather than one big streamed async IIFE.

---

## Browser Rendering for dynamic OG/social cards

**What**: Use the `@cloudflare/puppeteer` binding to screenshot a public page or Canvas layout at the edge and save the PNG to the active media provider, for automatic social-share images instead of relying on a manually-set `ogImage`.

**Why valuable**: Every public page already has `seoTitle`/`ogImage` fields, but most content never gets a manually-designed share image. A generated card (title + site branding rendered over a template) is a meaningful default-quality improvement with no editor effort.

**What still needs to be built**: a `BROWSER` binding declaration, a render route that takes a content item's title/excerpt and produces a templated screenshot, a cache layer (these shouldn't regenerate on every request — publish-time generation, same trigger point as `trackPageView`), and a fallback to the existing manual `ogImage` field when set.

---

## AI feature UI follow-ups

Six small, well-scoped items left over from the Sept 2026 Cloudflare AI integration pass (Workers AI, AI Gateway, Vectorize/semantic search, AI page & site generation, and a batch of smaller AI features — all shipped; see CLAUDE.md's "AI providers"/"Multilingual content"/"Events system" sections for the technical reference and `docs/user-guide.md`'s "AI Features" section for the user-facing summary). Each of these already has working backend/API support — what's listed here is specifically the remaining frontend work:

- **Taxonomy/tag suggestion UI** — `POST /api/v1/ai/suggest-terms` works today, but there is no taxonomy-term-assignment UI anywhere in the content editor to wire a "suggest" button into (a pre-existing gap, not created by the AI work). Needs that base UI built first.
- **Voice-to-text recording UI** — `POST /api/v1/ai/transcribe` (Whisper) works today; needs a browser mic-permission + `MediaRecorder` recording widget in the editor to call it from.
- **AI-suggested focal point UI** — `POST /api/v1/ai/suggest-focal-point` works today; needs an "AI suggest" button wired into `CanvasBlockImage`'s focal-point sliders (a cross-package UI change in `@nuxflow/canvas`).
- **Cherry-pick / regenerate individual AI-generated pages** — a completed AI site-generation job's pages can only be reviewed as a whole batch today (each lands as an independent draft an editor can edit/delete individually, but there's no "regenerate just this one page" action tied back to the job).
- **Unsplash / placeholder image suggestions** for AI-generated pages — image blocks are left with empty `src` fields by default.
- **Full RAG grounding for AI page/site generation** — `generate-content.post.ts` (prose generation) already grounds its output in the site's existing content via semantic search; the block-based generators (`generateCanvasBlocks()`/`generateSitePages()`) don't yet do the same.

---

## [DEFERRED] Isolated App/Server TypeScript Type-Checking

### Status: Blocked on upstream Nuxt bugs — revisit on Nuxt upgrade

Unlike the feature work above, this is internal tooling debt, not a product feature — tracked here so the reasoning and exit condition aren't lost.

### The situation

`pnpm typecheck` currently type-checks the Vue app (`app/**`) and the Nitro server (`server/**`) as **one shared program** rather than two isolated ones. Nuxt generates separate sub-configs (`.nuxt/tsconfig.server.json` with `webworker` lib, no `dom`) that look like they'd isolate the two, but the root `apps/nuxflow/tsconfig.json` doesn't reference them, so `nuxt typecheck` never actually runs them as a proper composite build — it falls back to a single unified `vue-tsc --noEmit` pass, and server files end up pulled into the same program as app files via Nuxt's typed-`$fetch` route inference.

Practical effect: Cloudflare Workers runtime types (`apps/nuxflow/worker-configuration.d.ts`, added for the security audit's plugin-sandboxing work) are visible from browser-side Vue code too, and vice versa. Mostly harmless, but real — e.g. `Response.json()` returns `Promise<unknown>` (workerd's stricter typing) instead of `Promise<any>` (DOM's) even inside `.vue` components, because both are in the same program. Confirmed empirically, not theoretical — see `apps/nuxflow/tsconfig.json` and the "Cloudflare-specific utilities" section of `CLAUDE.md` for the full account.

### Why not fixed now

Nuxt's own docs confirm the unified pattern is legacy and will be replaced by TypeScript project references (`references: [...]` in the root tsconfig) — that's the correct target architecture, not a workaround. But turning it on today (Nuxt 4.4.x) hits multiple open upstream bugs:

- [nuxt/cli#1224](https://github.com/nuxt/cli/issues/1224) — `-b` build mode fails to resolve `declare global` auto-imports
- [nuxt/nuxt#34212](https://github.com/nuxt/nuxt/issues/34212) — typecheck errors on auto-imported Vue/Nuxt utils
- [nuxt/nuxt#35319](https://github.com/nuxt/nuxt/issues/35319) — crash combining `tsconfig.server.json` with certain SSR/typecheck settings

Switching now would trade one small, already-fixed type gap for currently-broken tooling. Not worth it pre-release.

### What to do when ready

This is a mechanical flip, not a redesign, once Nuxt fixes the issues above (or a Nuxt upgrade sidesteps them):

1. Add `"references": [{ "path": "./.nuxt/tsconfig.server.json" }]` (plus any other generated sub-configs worth isolating) to `apps/nuxflow/tsconfig.json`.
2. Run `pnpm typecheck` — this makes `nuxt typecheck` switch to `vue-tsc -b --noEmit` (composite build mode) automatically.
3. Confirm auto-imports (`ref`, `useState`, etc.) still resolve and nothing crashes.
4. If clean: remove the `REVISIT` comment block from `tsconfig.json`, and confirm `worker-configuration.d.ts` is only visible from server-side files (move it under `server/types/` if the isolated server tsconfig's `include` picks it up there instead of needing the project-root location the unified setup required).

No urgency to monitor actively — check when bumping Nuxt to a new major/minor, or if the linked issues show as closed.

---

## SMS Notifications

### Vision

Site owners and their users should be able to receive notifications via SMS in addition to email and browser push. Use cases include transactional alerts (new form submission, payment confirmation, membership expiry), admin digests, and member-facing notifications for time-sensitive content like events.

SMS is deliberately opt-in per user — no one receives a text message unless they have both provided a phone number and toggled SMS notifications on. Site owners choose one provider and configure it once in Admin → Settings → SMS, in the same way email is configured today.

### Why this is valuable

- **Higher open rates**: SMS open rates are typically 90%+ vs. 20–30% for email. For genuinely urgent notifications (event reminders, payment failures), SMS meaningfully increases the chance the user acts in time.
- **No extra infrastructure**: The notification system already fans out to email and browser push via `sendNotification()` in `server/utils/notify.ts`. SMS is a fourth flag on the same call — no new job queue, no new table, no new scheduled task.
- **Some providers are already half-integrated**: Brevo (already supported for email) offers a transactional SMS API on the same API key. Sites already using Brevo for email can enable SMS with zero additional credentials.
- **Edge-compatible**: All four target providers expose plain REST APIs with JSON bodies. No Node.js SDK required — pure `fetch()` calls, identical to how Resend/Brevo/ZeptoMail are implemented today.

### Provider comparison

| Provider           | Also does email?        | Auth                                   | Notes                                                                            |
| ------------------ | ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| **Twilio**         | Via SendGrid (separate) | Account SID + Auth Token + from number | Industry standard, widest global reach, MMS support, most Stack Overflow answers |
| **Vonage (Nexmo)** | Yes (Email API)         | API Key + API Secret + from            | Strong EU coverage, competitive pricing, unified comms platform                  |
| **Brevo**          | ✅ Already integrated   | Same API key as email                  | Lowest-friction option for sites already on Brevo — no new credentials required  |
| **Telnyx**         | No                      | Single API key                         | Developer-friendly REST API, competitive pricing, good documentation             |

Recommended default order: **Brevo** (if already configured) → **Twilio** → **Vonage** → **Telnyx**.

### Groundwork already in place

#### `phone` column on `users`

(Present since `packages/db/migrations/0000_baseline.sql` — earlier revisions of this doc cited migration `0008`, which is stale after a schema-history squash.)

A nullable `phone` text column was added to the `users` table proactively. It stores the user's phone number in E.164 format (e.g. `+447700900123`). Because it is nullable with no unique constraint, it has zero impact on existing users and zero risk of breaking the auth flow (Better Auth does not touch this column).

This column is the only place phone numbers live. There is deliberately no `sms_subscriptions` table — the `push_subscriptions` table pattern (one row per device per user) is not needed for SMS since phone numbers are already globally unique per person.

#### `SENSITIVE_SETTING_KEYS` pre-populated (`settings.ts`)

The following keys were added to `SENSITIVE_SETTING_KEYS` now so that any SMS credential stored in `site_settings` is automatically AES-GCM encrypted at rest from the moment the feature lands:

- `sms.twilio_auth_token`
- `sms.vonage_api_secret`
- `sms.brevo_api_key` _(shared with email if Brevo is the email provider)_
- `sms.telnyx_api_key`

#### Notification fanout architecture (`notify.ts`)

`sendNotification()` already accepts per-call flags to opt into email (`sendEmailNotification`) and push (`sendPush`). Adding `sendSms` follows the identical pattern — look up `users.phone`, call `sendSms(event, msg)`, catch and log errors without throwing. No callers need to change unless they want to opt into SMS for a specific notification type.

### What still needs to be built

#### 1. `server/utils/sms.ts` — provider dispatcher

Mirrors `email.ts` exactly:

```typescript
interface SmsMessage {
  to: string // E.164 format, e.g. +447700900123
  body: string // Plain text only — no HTML
}

interface SmsConfig {
  smsProvider: string // 'twilio' | 'vonage' | 'brevo' | 'telnyx' | 'console'
  twilio?: { accountSid: string; authToken: string; from: string }
  vonage?: { apiKey: string; apiSecret: string; from: string }
  brevo?: { apiKey: string; from: string }
  telnyx?: { apiKey: string; from: string }
}

export async function sendSms(event: H3Event, msg: SmsMessage): Promise<void>
```

Provider-specific implementation notes:

- **Twilio**: `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` with Basic auth (`AccountSID:AuthToken`), `application/x-www-form-urlencoded` body
- **Vonage**: `POST https://rest.nexmo.com/sms/json` with JSON body containing `api_key`, `api_secret`, `from`, `to`, `text`
- **Brevo**: `POST https://api.brevo.com/v3/transactionalSMS/sms` — same `api-key` header as the email integration, body has `sender`, `recipient`, `content`
- **Telnyx**: `POST https://api.telnyx.com/v2/messages` with `Authorization: Bearer {apiKey}`, JSON body

#### 2. `sendSms` flag on `sendNotification()` in `notify.ts`

```typescript
interface NotifyOptions {
  // ... existing fields ...
  sendSms?: boolean // Also send an SMS to the user's phone number if set
}
```

In the body: look up `users.phone`, skip silently if null, call `sendSms()`, catch and log errors without re-throwing (same pattern as `sendEmailNotification`).

#### 3. Settings keys for `loadSmsConfig()`

Settings to read via `resolveSetting()`:

| Key                      | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `sms.provider`           | Active provider: `twilio`, `vonage`, `brevo`, `telnyx`, `console` |
| `sms.twilio_account_sid` | Twilio Account SID (not sensitive — public identifier)            |
| `sms.twilio_auth_token`  | Twilio Auth Token (**encrypted**)                                 |
| `sms.twilio_from`        | Twilio sender number or alphanumeric ID                           |
| `sms.vonage_api_key`     | Vonage API Key                                                    |
| `sms.vonage_api_secret`  | Vonage API Secret (**encrypted**)                                 |
| `sms.vonage_from`        | Vonage sender name/number                                         |
| `sms.brevo_api_key`      | Brevo API Key (**encrypted**, shared with email if same provider) |
| `sms.brevo_from`         | Brevo sender name (alphanumeric, max 11 chars)                    |
| `sms.telnyx_api_key`     | Telnyx API Key (**encrypted**)                                    |
| `sms.telnyx_from`        | Telnyx sender number                                              |

#### 4. Admin UI — Settings → SMS tab

A new "SMS" tab in `app/pages/admin/settings/index.vue`, matching the layout of the existing Email tab:

- Provider selector dropdown (Console / Twilio / Vonage / Brevo / Telnyx)
- Conditional credential fields per provider (same show/hide pattern as email)
- "Send test SMS" button — posts to a new `/api/v1/settings/sms-test` endpoint that sends a real SMS to the admin's own phone number (requires `users.phone` to be set on their account)
- Save / mask behaviour identical to email (sensitive fields masked after save with `SECRET_MASK`)

#### 5. User profile — phone number field

The account settings page (Admin → My Account) needs a phone number input field:

- Validates E.164 format client-side before saving
- Saves via `PATCH /api/v1/users/me` (extend that route to accept `phone`)
- Separate from notification preferences — having a phone number stored does not automatically opt the user in to SMS

#### 6. SMS opt-in preference per user

A boolean user preference (stored as a site setting scoped to the user, or as a JSON column on `user_site_roles`) that controls whether `sendNotification(..., { sendSms: true })` actually sends. The flag in `sendNotification` should be treated as intent — the actual send should also check the user's preference and skip if they have not opted in.

The simplest implementation stores this as a `notifications_sms` boolean in a `user_preferences` JSON blob on `user_site_roles.preferences` (already a JSON column if added). Alternatively a `user_notification_prefs` table keyed by `(userId, siteId)` is cleaner if other per-user preferences accumulate.

#### 7. `/api/v1/settings/sms-test` endpoint

Mirrors `/api/v1/settings/email-test`. Loads SMS config via `loadSmsConfig()`, sends a fixed test message to the requesting user's `phone`, returns `{ ok: true }` or a descriptive error.

### What was explicitly ruled out

- **OTP / 2FA via SMS**: Better Auth handles multi-factor authentication. Integrating SMS-OTP into the auth flow requires hooking into Better Auth's plugin system specifically (it supports a `twoFactor` plugin). This is a distinct task from the transactional SMS feature above and should be tracked separately when 2FA is prioritised.
- **Bulk SMS / marketing campaigns**: Transactional SMS (one notification triggered by a real event) is the use case here. Bulk campaign sending involves list management, opt-out compliance (TCPA/GDPR), carrier reputation, and unsubscribe handling — a significantly different scope. Not planned.
- **Per-message cost visibility**: Carrier costs vary by country and provider. Surfacing per-message pricing in the admin is not worth the complexity; site owners should check their provider dashboard.
- **SMS as an auth channel (passwordless login)**: Similar to OTP/2FA — belongs in the auth layer, not the notification layer.

### Suggested implementation order

1. `server/utils/sms.ts` with Brevo support first (easiest, no new credentials for existing Brevo users)
2. `sendSms` flag on `sendNotification()` in `notify.ts`
3. Phone number field on user profile + `PATCH /api/v1/users/me` extension
4. Admin Settings → SMS tab + test endpoint
5. Add Twilio support (highest user demand)
6. Add Vonage and Telnyx support
7. User SMS opt-in preference

Steps 1–3 can be done in a single sitting. Steps 4–7 are polish and breadth.

---
