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

#### `version` column on `content_items` (added in migration `0004`)

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

## AI Page & Site Generation

### Vision

An editor describes a page or entire site in plain language — "a landing page for a SaaS product called Flux, dark theme, hero, three-column features, pricing table, FAQ, CTA, and footer" — and NuxFlow generates a fully-populated canvas page (or multiple linked pages) ready to publish or fine-tune.

For site generation, the flow is two-step: the AI first returns a **plan** (list of pages with titles, slugs, and descriptions) that the editor approves, then generates each page in parallel. The editor can accept the whole site, cherry-pick pages, or regenerate individual ones.

### Why this is valuable

- **Speed**: A complete multi-page site in under a minute instead of hours of dragging blocks.
- **Zero blank-page anxiety**: Even a rough AI draft is a better starting point than an empty canvas.
- **Block-aware output**: Because the AI is given the full `CanvasBlockDefinition` schema — field names, types, enums, and default values — it generates structured JSON that maps directly to real canvas blocks, not generic HTML that needs reformatting.
- **Provider-agnostic**: The existing `getAiSdkModel(event, 'smart')` abstraction supports five providers out of the box (OpenAI, Anthropic, Gemini, DeepSeek, Ollama). Whichever provider the site owner has configured will be used with no extra wiring.

### Groundwork already in place

**`ai_generation_jobs` table (added in migration `0005`)**

Multi-page site generation takes 30–60 seconds and involves multiple AI calls. Storing the job server-side means:

- The browser tab can be closed and the generation still completes.
- The editor can poll `/api/v1/ai/generate/:jobId` for progress without resubmitting the prompt.
- Completed jobs persist as a history (Admin → AI Generations) so editors can revisit or re-apply past generations.
- `generatedCount` / `totalCount` provide a progress percentage for the UI.
- `contentItemIds` records which content items were created so the editor can navigate directly to them or undo the whole generation in one action.

**Canvas block definitions already typed for AI prompts**

`CANVAS_BLOCKS` in `packages/canvas/src/blocks/definitions.ts` is a fully-typed `CanvasBlockDefinition[]` array describing every built-in block: its `id`, `name`, `description`, field keys, field types, enum options, and default props. This is exactly what an AI system prompt needs to generate valid block JSON — no separate schema document to maintain.

**Content stored as JSON (always the case)**

The `content` column on `content_items` is unstructured JSON. Canvas pages already store an array of `{ id, type, props }` objects. The AI just needs to produce the same shape — no schema migration required.

**ULIDs (always in place)**

Each generated block can receive a client-generated ULID as its `id` before being written to the database, so no sequential-ID round-trips are needed during batch generation.

### What still needs to be built

1. **`POST /api/v1/ai/generate`** — accepts a prompt and `type: 'page' | 'site'`, creates an `ai_generation_jobs` row, kicks off the AI call, and returns the job ID immediately.
2. **`GET /api/v1/ai/generate/:jobId`** — poll endpoint returning job status, plan, progress, and content item IDs on completion.
3. **AI prompting utility** — a server util that serialises `CANVAS_BLOCKS` (just `id`, `name`, `description`, and field metadata, not the Vue component refs) into an AI system prompt and uses JSON schema / tool-use mode for structured output.
4. **Two-phase site generation** — first call produces a plan (array of page stubs); second call (after user approval) generates block JSON for each page, updating `generatedCount` as each completes.
5. **Admin UI** — a modal in the canvas editor ("Generate page…") and a page in Admin → Content ("Generate site…") with a text area, a plan-review step for site generation, and a progress bar.
6. **Unsplash / placeholder image integration** — image blocks are left with empty `src` fields by default; a future enhancement could suggest Unsplash search terms alongside each image block.

### What was explicitly ruled out (for now)

- **Streaming to the browser during generation**: Complex to implement correctly with the Cloudflare Workers streaming constraints. The poll pattern above is simpler and covers all browsers without SSE edge-case handling.
- **RAG / existing content context**: Injecting the site's existing pages into the AI prompt to maintain tone and style would significantly improve output quality, but adds complexity (context window size, chunking). Left for a v2 of the feature.

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

## [COMPLETED] Multilingual Content (Translations)

### Status: Fully Implemented & Shipped

Content editors can translate any content item (blog posts, standard pages, or visual Canvas block pages) into multiple languages with a single click. The serving, management, and routing infrastructure are fully active.

### Implementation Details

#### 1. Dynamic Path-Prefixed serving with Fallback
The public pages API (`GET /api/public/pages/[slug]`) automatically parses locale path prefixes (e.g., `/es/my-page` resolves to `locale = 'es'` and `slug = 'my-page'`).
- **Graceful Fallback:** If a translation doesn't exist for the requested locale, it gracefully degrades to serving the original master language page.
- **Translation Linkages:** Alternate locales are returned in the `availableLocales` metadata array.

#### 2. Public Header Language Switcher
- A visual dropdown globe selector is integrated into the public header navigation. It reads the shared `active-locales` Nuxt state and lists all available translations for the active page, allowing visitors to switch languages seamlessly.

#### 3. Administrative Panel Management
- **Status Badges:** The Content index page (`/admin/content`) displays language badges (e.g., `EN`, `ES`, `FR`) next to each title.
- **Language Filter:** A dropdown filter is added to the header so administrators can isolate content items of a specific language.
- **Sidebar Integration:** Extended POST/PATCH schemas allow manual updates of locale values and source linkages.

#### 4. Backup & Restoration Integrity
- The backup/restore utility (`server/utils/backup.ts`) fully exports `locale` and `sourceItemSlug` properties.
- During imports, a second-pass routine automatically re-maps parent translation IDs to child translation rows using restored slug lists, ensuring all relationships are preserved even when internal database IDs are regenerated.

---

## [COMPLETED] Events System

### Status: Fully Implemented & Shipped

NuxFlow now supports a complete Events System. Sites can define events (meetups, conferences, webinars), display them on calendars/visual blocks, and let visitors export them directly to calendar clients.

### Implementation Details

#### 1. Content Seeding
The built-in `event` content type is seeded automatically on site installation in [complete.post.ts](file:///c:/DEV/NuxFlow/apps/nuxflow/server/api/v1/setup/complete.post.ts).

#### 2. Editor Side Panels
When creating or editing content of type `event` in [[id].vue](file:///c:/DEV/NuxFlow/apps/nuxflow/app/pages/admin/content/%5Bid%5D.vue), an **Event Details** sidebar card becomes active. This maps standard fields:
- Start Date/Time (`eventStartAt`)
- End Date/Time (`eventEndAt`)
- All-Day Event Switch (`eventAllDay`)
- Location / Venue (`eventLocation`)
- Registration Link (`eventUrl`)

#### 3. Editorial & Admin Calendar
In the dashboard Editorial Calendar (`/admin/calendar`), event items query their `eventStartAt` column and snap directly to the target event day rather than their publication date.

#### 4. Public API & ICS Calendar Feed
- **Events List API:** [events.get.ts](file:///c:/DEV/NuxFlow/apps/nuxflow/server/api/public/events.get.ts) serves upcoming published events.
- **iCal Subscription Feed:** [events.ics.ts](file:///c:/DEV/NuxFlow/apps/nuxflow/server/routes/events.ics.ts) serves a standard-compliant iCal subscribe path `/events.ics`.

#### 5. Visual Canvas Block
- **Events Calendar Block:** Visual Canvas Block [CanvasBlockCalendar.vue](file:///c:/DEV/NuxFlow/packages/canvas/src/blocks/CanvasBlockCalendar.vue) is shipped. It supports:
  - **List View:** Display cards of upcoming events.
  - **Month View:** Displays an interactive calendar picker widget.
  - **Add to Calendar Buttons:** Generates and downloads `.ics` files client-side directly on button click.

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

#### `phone` column on `users` (added in migration `0008`)

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
