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

`CANVAS_BLOCKS` in `packages/plugins/canvas/src/blocks/definitions.ts` is a fully-typed `CanvasBlockDefinition[]` array describing every built-in block: its `id`, `name`, `description`, field keys, field types, enum options, and default props. This is exactly what an AI system prompt needs to generate valid block JSON — no separate schema document to maintain.

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

| Field | Value |
|---|---|
| `blobs[0]` | Page slug |
| `blobs[1]` | Visitor country (from `cf-ipcountry` header) |
| `blobs[2]` | Referrer URL (truncated to 256 chars) |
| `doubles[0]` | `1` (page view count — SUM this in queries) |
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

## Multilingual Content (Translations)

### Vision

Content editors can produce any content item (blog post, page, canvas page) in multiple languages. The AI does the heavy lifting — a single button click in the editor sends the entire piece to the configured AI provider, which returns a fully translated copy including the title, body, SEO fields, excerpt, and canvas block text. Translated content is saved as a separate draft for review before publishing.

On the public-facing site, visitors are served the correct language version based on a URL convention (e.g. `/es/mi-articulo`) or a query parameter, with automatic fallback to the default-language version if a translation doesn't yet exist for the requested locale.

### Why this is valuable

- **No third-party i18n service needed**: The existing AI provider abstraction (`getAiSdkModel`) already supports five providers. Translation costs are absorbed into the AI plan the site owner already has configured.
- **Both content types covered**: The translation engine handles both TipTap rich-text documents (recursive node traversal) and Canvas block pages (per-prop extraction from known block fields) without any extra configuration per block type.
- **Human-review workflow baked in**: Translations are always created as drafts. The editor navigates to the new draft and publishes when satisfied, preventing AI hallucinations from going live unreviewed.
- **Idempotent**: Running the translator again for the same locale updates the existing translation rather than creating a duplicate.

### Groundwork already in place

#### Database schema (fully in place)

Two columns were added to `content_items` specifically for this feature:

| Column | Type | Purpose |
|---|---|---|
| `locale` | `text`, default `'en'` | Language code of this item (e.g. `'es'`, `'fr'`, `'zh-CN'`) |
| `sourceItemId` | `text`, FK → `content_items.id` | Points to the original-language item this was translated from |

Both are indexed for efficient querying:
- `idx_content_items_locale` on `(site_id, locale)` — list all content in a given language
- `idx_content_items_source` on `(source_item_id)` — find all translations of a given item

The `sites` table also has a `locale` column (default `'en'`) that records the site's primary language.

#### AI translation engine (`POST /api/v1/ai/translate`)

The server-side translation route is complete and production-ready:

- **TipTap extraction**: Recursively walks the ProseMirror JSON tree, collects every text leaf, bundles them into a single AI call (to minimise token overhead and keep context coherent), then maps the translated strings back onto the same node positions.
- **Canvas extraction**: Reads a known set of translatable props from each block — `title`, `subtitle`, `description`, `headline`, `quote`, `ctaLabel`, `authorName`, `caption`, and others — translates them as a batch, and writes them back to the same block positions.
- **Metadata fields**: `title`, `seoTitle`, `seoDescription`, and `excerpt` are all translated in the same AI call.
- **Slug handling**: The translated item receives a slug of `{originalSlug}-{locale}` by default (e.g. `my-post-es`), avoiding collisions with the source item.
- **Update-or-create**: If a `content_items` row already exists with the matching `sourceItemId` + `locale`, the route updates it instead of creating a duplicate.
- **Rate limiting**: Five translations per user per 60 seconds, enforced by the standard `rateLimit()` utility.
- **Audit log**: Every translation (create or update) writes an audit log entry.

#### Editor UI (fully in place)

- A **Translate** button with a language icon lives in the content editor toolbar (visible only when editing an existing item, not for unsaved new items).
- Clicking it opens `TranslateModal.vue`, which offers a dropdown of 15 pre-configured locales: Spanish, French, German, Italian, Portuguese, Dutch, Polish, Japanese, Simplified Chinese, Traditional Chinese, Korean, Arabic, Russian, and Hindi — plus a free-text input for any other locale code (e.g. `pt-BR`).
- On success the modal emits the new item's ID and the editor navigates directly to the translated draft, ready for review.

### What still needs to be built

The entire *creation* side is done. The *serving and management* side is not.

#### 1. URL strategy decision (required first)

Before building public routing, a URL convention must be chosen. The three realistic options:

| Strategy | Example URL | Trade-offs |
|---|---|---|
| Path prefix | `/es/mi-articulo` | SEO-friendly, requires Nuxt `i18n` routing or middleware rewrite |
| Query parameter | `/my-post?locale=es` | Simplest to implement, less SEO-friendly |
| Slug per locale | `/mi-articulo` (distinct slug) | Cleanest URLs, requires the CMS editor to set a locale-appropriate slug manually |

The path-prefix strategy is the most conventional and SEO-friendly. It would require a route rewrite in `server/middleware` that strips the locale prefix and sets `event.context.locale` before multi-site resolution runs.

#### 2. Public pages API — locale-aware serving

`GET /api/public/pages/[slug]` currently ignores `locale` entirely. Changes needed:

- Accept an optional `locale` query parameter or read `event.context.locale` from middleware.
- When locale is set, prefer the `content_items` row where `slug` matches AND `locale` matches.
- If no match for the requested locale, fall back to the source-language item (graceful degradation).
- Return a `locale` field and an `availableLocales` array (queried via `sourceItemId`) so the frontend can render a language switcher.

#### 3. Admin — translation status in the content list

The content list at `/admin/content` currently shows all languages mixed together with no indication of which items are translations. Required:

- A locale badge on each row (pill showing `EN`, `ES`, etc.)
- An optional locale filter dropdown in the list header.
- A visual grouping or indentation to show that item B is a translation of item A.

#### 4. Admin — translations panel in the content editor sidebar

When editing a content item, a sidebar card should show:
- Which locale this item is (badge)
- If it's a translation: a link back to the source/original item
- If it's a source: a list of all existing translations (with locale code + status badge) and a link to each
- A "Translate to…" button that opens the same `TranslateModal` (already exists) for locales not yet translated

#### 5. Locale in content POST and PATCH

`POST /api/v1/content` always inherits the site's default locale; `PATCH /api/v1/content/:id` doesn't accept a `locale` field at all. Both schemas need:

```typescript
locale: z.string().max(10).optional(),        // e.g. 'es', 'pt-BR'
sourceItemId: z.string().optional(),          // only on POST, to link manually
```

This allows editors to create or correct locale manually without going through the AI translate flow.

#### 6. Language switcher on public pages

Once locale routing is live, the public site needs a way to switch between available translations. This is a small component that reads `availableLocales` from the page API response and renders flag icons or language names linking to the alternate-locale URL.

#### 7. Setup wizard — expose locale selector

The site creation wizard (`StepSite.vue`) currently offers only `English` in the locale dropdown. The full locale list already used in `TranslateModal.vue` should be reused here so the site default locale can be set correctly from the start.

#### 8. Backup/restore — preserve translation links

The backup utility (`server/utils/backup.ts`) exports content items but does not include `locale` or `sourceItemId` in the export format. Restoring a backup silently drops all translation relationships. The export schema needs these fields, and the import logic needs to restore `sourceItemId` references after all items are written (since the IDs must exist before the FK can be set).

### Suggested implementation order

1. Decide URL strategy (product decision, no code yet)
2. Add `locale` + `sourceItemId` to POST/PATCH schemas (small, self-contained)
3. Update public pages API to be locale-aware with fallback
4. Add locale routing middleware (or query-param support if going that route)
5. Add translations panel to the content editor sidebar
6. Add locale filter and badges to the content list
7. Add language switcher component to public pages
8. Fix setup wizard locale dropdown
9. Fix backup/restore to include translation metadata

Steps 2–3 unblock everything else and are the logical first sprint.

---

## Events System

### Vision

Sites built on NuxFlow should be able to manage a public-facing events calendar — conferences, workshops, webinars, product launches, meetups — with start/end dates, location, optional RSVP/ticketing via the existing payments infrastructure, and iCal export so visitors can add events to their calendars.

An events content type behaves like any other content type (rich text body, SEO fields, taxonomy tagging, media) but adds a structured event layer on top: a date range, an optional venue, and a link to an external URL (livestream, registration page, or ticket purchase).

### Why this is valuable

- **No extra plugin needed for most sites**: A conference site, a yoga studio, a local community group — all common NuxFlow use cases that need an events section. Without a built-in answer they reach for a plugin or a third-party embed.
- **Canvas Calendar block**: A canvas block that renders a month-view or list-view of upcoming events, fully themed to the site's design, gives editors a no-code way to embed the calendar on any page.
- **iCal export**: A standard `/events.ics` route lets visitors add the full event list to Google Calendar, Apple Calendar, or Outlook without any additional integration. For individual events, an "Add to calendar" button on the event page covers the single-event case.
- **RSVP and paid ticketing**: Events can optionally require the existing membership tier check (`settings.access: 'tier:<id>'`) so paid events work out of the box via Stripe/LemonSqueezy, reusing all the existing payments infrastructure.

### Groundwork already in place

#### Event fields on `content_items` (added in migration `0006`)

The following columns were added proactively to the `content_items` table. They are `NULL` on all regular content and only populated when a content type is used as an events calendar:

| Column | Type | Purpose |
|---|---|---|
| `event_start_at` | `text` (ISO 8601) | Event start — ISO string for correct SQLite string comparisons in date range queries |
| `event_end_at` | `text` (ISO 8601) | Event end — `NULL` for single-day all-day events |
| `event_location` | `text` | Venue name, address, or "Online" |
| `event_url` | `text` | Optional external link (livestream, registration page) |
| `event_all_day` | `integer` (boolean) | Whether times should be ignored in display and iCal output |

An index on `(site_id, event_start_at)` — `idx_content_items_event_start` — enables efficient range queries for upcoming events and the iCal feed without a full table scan.

#### Editorial Calendar already ships (implemented)

The admin already has a month-view Editorial Calendar at `/admin/calendar` that shows published and scheduled content items by date. While it is not yet event-aware (it ignores `event_start_at`), its infrastructure — the `GET /api/v1/content/calendar` endpoint and the `CalendarItem` type — is the foundation the Events version will extend: just add `eventStartAt` to the returned fields and let the calendar page render event items by their event date rather than publication date.

#### Existing payments gate

`resolveContentGate()` in `server/utils/payments/gate.ts` already supports `settings.access: 'tier:<tierId>'`. A paid event page sets this on its content item; no new gating code is needed for basic paid events.

### What still needs to be built

1. **Events content type scaffold** — a "Create Events content type" shortcut in the admin (or at minimum, documentation) that creates a content type with slug `event`, sets `isBuiltIn: true`, and applies sensible defaults for `hasRevisions` and `hasComments`.
2. **Event metadata panel in the content editor** — a sidebar card that appears when `contentType.slug === 'event'` (or when event fields are non-null), exposing date/time pickers for `event_start_at`/`event_end_at`, a location field, the external URL field, and an all-day toggle.
3. **Public events API** — `GET /api/public/events` with `from`, `to`, `limit`, `offset` query params; queries by `event_start_at` using the new index. Supports iCal output via `Accept: text/calendar` or `?format=ics`.
4. **`/events.ics` route** — returns upcoming events (next 90 days by default) as a standards-compliant iCal feed (`VCALENDAR` + `VEVENT` components) for calendar app subscriptions.
5. **Canvas Calendar block** — a new block in `packages/plugins/canvas/src/blocks/` that renders a month or list view of events, fetching from the public events API. The block props control date range, which content type slug to pull events from, and display mode (`month` | `list`).
6. **"Add to calendar" button** — a small component on event pages that generates an `.ics` file for a single event and triggers a browser download, plus links to Google Calendar and Outlook web URLs.
7. **RSVP / registration** — for free events: a simple RSVP form (reuse the existing `forms` table); for paid events: redirect to the existing checkout flow with the membership tier gate.
8. **Recurrence** — out of scope for v1; recurring events are typically managed as separate content items. A `recurrenceRule` JSON field can be added later for iCal `RRULE` generation.

### Suggested implementation order

1. Event metadata panel in the content editor sidebar (unblocks content creation)
2. Public events API with iCal output (unblocks embeds and subscriptions)
3. `/events.ics` route (thin wrapper over the API)
4. Canvas Calendar block (highest visibility, drives adoption)
5. "Add to calendar" button component
6. RSVP / registration (requires deciding free vs. paid event UX first)
