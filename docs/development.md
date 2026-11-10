# Development Guide

This guide is for contributors and developers working on NuxFlow itself — modifying the source code, changing the database schema, writing tests, or building new features. If you want to deploy NuxFlow for your own site, see the [Installation Guide](./installation.md).

## Prerequisites

Install the following tools before you begin:

- **Node.js** 22.22 or higher
- **pnpm** 9 or higher — `npm install -g pnpm`
- **Wrangler** v4 (Cloudflare CLI) — `pnpm add -g wrangler`

---

## Monorepo Structure

NuxFlow is a pnpm monorepo managed with [Turborepo](https://turbo.build). The workspace is organised as follows:

```
nuxflow/
├── apps/
│   └── nuxflow/          # Main Nuxt 4 application (the CMS)
├── packages/
│   ├── canvas/           # Canvas page builder engine (blocks, editor, types)
│   ├── db/               # Drizzle schema and migrations — D1-only, no client factory
│   ├── cli/              # NuxFlow CLI tool
│   ├── router/           # Optional front-door Worker for hosting platforms with member pools
│   └── create-nuxflow-app/  # `pnpm create nuxflow-app` scaffolder
├── themes/
│   └── default/          # Default CSS theme
├── examples/             # Example themes and plugins
└── docs/                 # Documentation source
```

Most day-to-day development happens in `apps/nuxflow` and `packages/db`. The packages are linked via workspace references — changes to `packages/db/src/schema` are immediately reflected in `apps/nuxflow` without a build step.

---

## Getting Started

Clone the repository and install dependencies from the repo root:

```bash
git clone https://github.com/NuxFlow/NuxFlow.git
cd nuxflow
pnpm install
```

### Copy Wrangler Configuration

NuxFlow uses Wrangler for local development and edge deployment. Copy the example wrangler config file inside the app folder:

```bash
cp apps/nuxflow/wrangler.toml.example apps/nuxflow/wrangler.toml
```

### Set Up the Local Database

**Cloudflare D1 via `wrangler dev` (the only supported path):**

This is the closest to production. `wrangler dev` provisions a local D1 SQLite database automatically. Run from the `apps/nuxflow` directory:

```bash
cd apps/nuxflow
wrangler dev
```

`pnpm dev` from the repo root runs the same thing — there is no separate `nuxt dev` path.

Database migrations run automatically on the first request. Visit `http://localhost:8787/setup`.

> [!NOTE]
> **Working with Production Database Dumps:** Argon2id password hashing runs directly in the Worker in both `wrangler dev` and production (see `server/utils/argon2.ts`), so an imported production `$argon2id$` password hash verifies locally exactly as it does in production — no separate step needed. If a login still fails after importing a dump, reset the affected user's password in your local database using a seed script, SQLite shell, or by re-running the setup wizard.

---

## Root Scripts

The following scripts are available from the repo root and run across all packages via Turborepo:

| Command | Description |
|---|---|
| `pnpm dev` | Build the app and start `wrangler dev` (http://localhost:8787) |
| `pnpm build` | Build all packages and the app |
| `pnpm lint` | Run ESLint across the monorepo |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run Playwright end-to-end tests |

You can also run these commands scoped to a single package using the `--filter` flag:

```bash
pnpm --filter @nuxflow/app lint
pnpm --filter @nuxflow/db generate
```

---

## Database Schema and Migrations

NuxFlow uses [Drizzle ORM](https://orm.drizzle.team) with a SQLite dialect targeting Cloudflare D1.

### Schema files

The database schema lives in `packages/db/src/schema/`. Each file groups related tables:

| File | Contents |
|---|---|
| `sites.ts` | Sites, site settings |
| `users.ts` | Users, sessions, accounts, API keys, passkeys, roles, invitations, site sessions |
| `content.ts` | Content types, items, revisions, taxonomies, menus, redirects, comments, event RSVPs and resources |
| `media.ts` | Media library, folders, video assets |
| `forms.ts` | Forms, submissions |
| `payments.ts` | Membership tiers, subscriptions, class passes and holdings |
| `email.ts` | Mailboxes, email messages, email log, mailing list subscribers |
| `hosting.ts` | Hosting plans, hosting subscriptions, a site's extra domains |
| `system.ts` | Plugins, themes, audit logs, notifications, rate limits, AI jobs, crawler activity, per-site usage counters, pool settings and the site directory, site moves |

All schema files are re-exported from `packages/db/src/schema/index.ts`.

### Adding a schema change

When you need to add a table, add a column, or create an index, follow these steps:

**1 — Edit the schema.** Modify the relevant file in `packages/db/src/schema/`.

**2 — Generate the migration.** Run Drizzle Kit from the `packages/db` directory. It diffs your schema against the stored snapshot and produces a new SQL file:

```bash
pnpm --filter @nuxflow/db generate
```

This creates a new numbered file in `packages/db/migrations/` (e.g. `0002_your_description.sql`) and updates `meta/_journal.json`.

**3 — Review the generated SQL.** Open the new file and confirm it contains exactly what you expect before committing. **If it contains `PRAGMA foreign_keys = OFF;`, stop:** drizzle-kit is rebuilding a table, and on D1 the rebuild's `DROP TABLE` can silently delete rows in every table that references it. Rewrite the change so it doesn't need a rebuild.

**4 — Commit the migration alongside the schema change.** Migration files are source code. Every schema change should be committed with its corresponding migration in the same commit so the two are always in sync.

### How migrations are applied

NuxFlow applies migrations automatically — no manual `wrangler d1 execute` or `migrate` commands are needed.

When a Worker receives its first request after a deploy (or cold start), the migration middleware in `apps/nuxflow/server/middleware/00.migrate.ts` runs the following logic:

1. Reads all `.sql` files from `packages/db/migrations/` (bundled into the Worker as server assets at build time)
2. Creates a `_nuxflow_migrations` tracking table if it does not exist
3. Checks which files have already been applied
4. Executes any new files in alphabetical order
5. Records each applied file in the tracking table

All subsequent requests skip this entirely — the result is cached in a module-level promise for the lifetime of the Worker isolate.

::note
**A database from before the squash has to be recreated.** The history was squashed into `0000_schema.sql` and `0001_search.sql` before the first release. A database built by the older files has filenames recorded that this build doesn't ship, so the migration step logs an error and applies nothing, and the app keeps running on the old tables, where anything new fails. Locally, stop the dev server and delete `apps/nuxflow/.wrangler/state/v3/d1` (your local test data goes with it). On a deployed site, download each site's backup, create a fresh D1 database and restore.
::

### Drizzle Studio

To browse your database visually, run Drizzle Studio against your configured database:

```bash
pnpm --filter @nuxflow/db studio
```

This opens a local web UI at `https://local.drizzle.studio`.

---

## Testing

### Unit tests

Unit tests live in `apps/nuxflow/tests/unit/` and use [Vitest](https://vitest.dev).

```bash
pnpm --filter @nuxflow/app test
```

To run in watch mode during development:

```bash
pnpm --filter @nuxflow/app test:watch
```

### Integration tests

Integration tests live in `apps/nuxflow/tests/integration/`. They call real route handlers and server utilities against a real SQLite database (created fresh for each test file from the same migrations D1 runs), with network calls to payment, email and AI providers mocked.

```bash
pnpm --filter @nuxflow/app test:integration
```

#### The tenant query guard

Every site on a multi-site install shares one database, so a query that forgets to filter by `site_id` could show or change another site's data. While the integration tests run, NuxFlow checks every SQL statement the server code sends. If a statement reads, updates or deletes a table that has a `site_id` column without a `site_id` condition, that test file fails and names the file and line:

```
Tenant query guard: 1 statement(s) touch a site-scoped table without filtering by site_id.
  • server/api/v1/example.patch.ts:21 — no site_id filter on media
```

Fix it by adding the condition, even on an update by an id you already checked. The shared helper `scopedById()` in `server/utils/db-helpers.ts` does exactly that.

A few queries are cross-site on purpose, such as scheduled jobs that run for every site and a person's own data export. Those are listed in `ALLOWLIST` in `apps/nuxflow/tests/helpers/tenant-query-guard.ts`, each with a one-line reason. A new cross-site query needs an entry there. If the reason is hard to write, the query probably needs a `site_id` filter instead.

Inserts aren't checked, because they set `site_id` rather than filter on it. Tables that belong to a site only through a parent row (revisions, taxonomy terms, term assignments) have no `site_id` column and aren't checked either.

### End-to-end tests

End-to-end tests use [Playwright](https://playwright.dev) and live in `apps/nuxflow/tests/e2e/`.

```bash
pnpm --filter @nuxflow/app test:e2e
```

### Lint and type checking

Run ESLint and TypeScript checks before opening a pull request:

```bash
pnpm lint
pnpm typecheck
```

Both checks run in CI on every push and pull request. A failing lint or typecheck will block the merge.

---

## Versioning and Releases

NuxFlow uses [Changesets](https://github.com/changesets/changesets) to version the packages that are actually published to npm: `@nuxflow/cli` and `create-nuxflow-app`. Every other package in the workspace (`@nuxflow/app`, `@nuxflow/canvas`, `@nuxflow/db`) is marked `"private": true` and is versioned independently, not released to npm, and doesn't need a changeset for internal-only changes — it just ships as part of the main app deploy.

### Adding a changeset

If your change touches the CLI or the `create-nuxflow-app` scaffolder, add a changeset describing what changed:

```bash
pnpm changeset
```

The CLI prompts you to select a bump type (`patch`, `minor`, or `major`) and write a summary. This creates a file in `.changeset/` that you commit alongside your code changes.

### Creating a release

When it is time to cut a release, a maintainer runs:

```bash
pnpm run version   # consumes all pending changesets and bumps package.json versions
pnpm release       # builds everything and publishes to npm
```

Use `pnpm run version`: plain `pnpm version` is npm's own command, not this script. The **Release** GitHub Action normally does both steps, through its "chore: release packages" pull request.

### Commit message convention

This project follows [Conventional Commits](https://www.conventionalcommits.org). The commit prefix determines how changes appear in the changelog:

| Prefix | When to use |
|---|---|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change with no behaviour change |
| `test:` | Adding or updating tests |
| `chore:` | Build scripts, tooling, dependencies |

Commit messages are linted by commitlint in CI.

---

## Plugin Development

NuxFlow supports **dynamic plugins** — independently-installed Cloudflare Worker extensions that can add new Canvas blocks, admin pages, and server routes to a site. There's no shared SDK package to depend on — a plugin is a `nuxflow.plugin.json` manifest plus a raw `src/server.ts` Worker handler, a `src/blocks.json` (plain-data Canvas block metadata), and/or a `src/client.ts` exporting a `renderBlock(blockId, vue)` function that only ever runs inside a sandboxed iframe, never in the main app. Plugin authors are told to inline their own copies of the small shared type shapes rather than import from `@nuxflow/*`.

For a complete guide covering plugin structure, Canvas block registration, signing, and publishing, see the [External Plugin Development Guide](./plugins.md).

> **Note on built-in features:** Contact Forms, Memberships/Commerce, and the HTML block are first-class NuxFlow features, not plugins. Their components live in `apps/nuxflow/app/components/` and their server routes in `apps/nuxflow/server/api/`. They appear in the Canvas block picker under their own categories (Forms, Commerce, Advanced).

---

## Theme Development

A NuxFlow theme is a CSS file that overrides design tokens and adds selectors targeting public-facing pages. Themes can optionally include a `theme.json` metadata file and a `demo.json` file containing starter content.

The authoritative reference for every available token and selector is `themes/default/assets/css/theme.css`. It is heavily commented and organised into sections — use it as the starting point for any new theme.

The `examples/hello-theme/` directory is a working example theme with a warm sunset palette. It is the recommended starting point.

### Testing a theme locally

Build your theme into a zip package and upload it through the admin:

1. Create a zip containing `theme.css` and optionally `theme.json` and `demo.json`
2. Go to **Admin → Themes → Install theme**
3. Activate the theme and inspect the result on the public site

A theme bundle can also be published as a **starter site** that every install can pick (Admin → Starter sites and the setup wizard) — see [Starter sites](./starter-sites.md#making-a-starter-site).

To include starter content images in `demo.json`, place them in an `images/` folder inside the zip. NuxFlow uploads them to your configured media provider and rewrites the references automatically.

> **Keep bundled images under 512 KB.** If the installing site hasn't connected R2 or Cloudflare Images (common on a fresh install, before any provider setup), uploads fall back to storing the image as base64 directly in a D1 column — capped at 512 KB, since D1 rows have a hard 1 MB limit and base64 inflates size by ~33%. An image over that cap fails to upload; the theme installs anyway, but that image reference in `demo.json` is left as the raw zip-relative path and renders as a broken image on the page. Compress/resize theme images to comfortably clear 512 KB so the demo content works out of the box regardless of what the installing site has configured.

### How the CSS pipeline works

Theme CSS is stored in Cloudflare KV and injected as an inline `<style data-nuxflow-theme>` block into the `<head>` of every SSR page response — no redeploy needed, and no flash of the default theme on first paint.

Three additional CSS custom properties are injected separately from **Admin → Themes → Appearance** settings:

| CSS variable | Source |
|---|---|
| `--nuxflow-primary` | Accent colour picker |
| `--nuxflow-font` | Body font selector |
| (dark class on `<html>`) | Colour scheme setting |

Your theme CSS can reference `var(--nuxflow-primary)` to pick up the user-chosen accent colour. This means a theme author can leave the exact colour open-ended and let site owners choose it without editing CSS.

### Available CSS tokens

#### Appearance settings bridge

```css
/* Injected per-request from Admin → Themes → Appearance */
var(--nuxflow-primary)   /* accent colour, e.g. #00dc82 */
var(--nuxflow-font)      /* font-family stack, e.g. 'Inter', system-ui */
```

#### Admin dashboard glass surfaces

```css
:root {
  --glass-bg:           rgba(255, 255, 255, 0.88);  /* header bar    */
  --glass-border:       rgba(0, 0, 0, 0.09);
  --glass-xl-bg:        rgba(255, 255, 255, 0.94);  /* sidebar       */
  --glass-xl-border:    rgba(0, 0, 0, 0.08);
  --shadow-glass:       …;
  --shadow-glass-hover: …;
}

.dark {
  --glass-bg:        rgba(8, 16, 30, 0.40);
  --glass-xl-bg:     rgba(8, 16, 30, 0.60);
  /* …borders and shadows */
}
```

#### Admin page background

```css
.mesh-bg { background-color: #ffffff; }

.dark .mesh-bg {
  background-color: #040e1a;
  background-image: radial-gradient(…green…), radial-gradient(…blue…), radial-gradient(…purple…);
}
```

#### Admin sidebar active item

Exactly one link has this class at a time. A closed group, or a group in the collapsed sidebar, has it while the current page is inside that group.

```css
.nav-active       { background: …; color: …; }  /* light mode */
.dark .nav-active { background: …; color: …; }  /* dark mode  */
```

### Canvas block selectors

Pages using the Canvas page builder render **full-width** with no outer container. Every block has a semantic class on its root element:

| Selector | Block |
|---|---|
| `.canvas-hero` | Hero / banner section |
| `.canvas-features` | Feature grid. Inside it, `.canvas-features-grid` carries `data-count` (1–4 cards) and each card is `.canvas-features-card`. Target those rather than the grid's Tailwind `grid-cols-*` classes, which change with screen size: phones show one card per row, tablets two, and desktops three or four. |
| `.canvas-image` | Image block — `<figure>` inside holds the image |
| `.canvas-gallery` | Gallery. `data-layout` is `grid`, `masonry` or `justified`; each photo is a `.canvas-gallery-item` `<figure>` and its caption (when shown) `.canvas-gallery-caption`. The "Download all" button (when downloads are on) is `.canvas-gallery-download`. The full-screen lightbox's caption is `.nux-lightbox-caption` and its download button `.nux-lightbox-download`. |
| `.canvas-carousel` | Image carousel / slider. A slide's caption is `.canvas-carousel-caption`. |
| `.canvas-text` | Rich text / prose block |
| `.canvas-columns` | Multi-column layout |
| `.canvas-testimonial` | Testimonial / quote card |
| `.canvas-cta` | Call-to-action banner |
| `.canvas-spacer` | Vertical spacer / divider |
| `.canvas-calendar` | Events Calendar. In its weekly view, `.canvas-timetable` wraps the week, each day is `.canvas-timetable-day`, and each class is `.canvas-timetable-class`. |
| `.canvas-class-passes` | Class Passes. Each pass on sale is `.canvas-class-pass`. |
| `.nux-blocks` | Outer wrapper for the entire canvas page |

Event pages aren't Canvas blocks, but have the same kind of hook: `.nuxflow-event-details` for the date and place, and `.nuxflow-event-rsvp` for the booking form.

Because Canvas pages are full-width, add `max-width` constraints inside your selectors to prevent elements from stretching on large viewports:

```css
/* Keep hero text readable on ultra-wide screens */
.canvas-hero .max-w-5xl { max-width: 1024px; }

/* Constrain images with a glow border */
.canvas-image figure,
.nux-blocks figure {
  max-width: 900px;
  margin-left: auto;
  margin-right: auto;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
```

### Content typography selector

`.nux-content` wraps all TipTap-rendered rich text (standard block editor — blog posts, pages that are not Canvas). Style it to match your theme:

```css
.nux-content a       { color: var(--nuxflow-primary, #00a86b); }
.dark .nux-content a { color: var(--nuxflow-primary, #00dc82); }

.nux-content blockquote { border-left-color: var(--nuxflow-primary, #00dc82); }
```

### ZIP packaging

A theme zip must contain `theme.css` at the root. Optional files: `theme.json` (name, version metadata) and `demo.json` (starter content). Images referenced in `demo.json` go in an `images/` subfolder, each **under 512 KB** (see the note above).

Windows zip utilities write backslash paths (`images\photo.png`). NuxFlow normalises these automatically on upload, but using POSIX paths (`images/photo.png`) is safer across all platforms.

### demo.json format

`demo.json` follows the `NuxFlowBackup` schema (`server/utils/backup.ts`). The easiest way to generate one is to build your content in the admin and export it from **Administration → Import & backup → Backup**. If you write it by hand, the top-level shape is:

```json
{
  "version": "1",
  "exportedAt": "2026-01-01T00:00:00Z",
  "site": { "name": "My Theme", "locale": "en", "timezone": "UTC" },
  "settings": {},
  "contentTypes": [],
  "content": [],
  "taxonomies": [],
  "menus": [],
  "forms": [],
  "media": [],
  "redirects": []
}
```

**Settings** are applied in two ways:

- **Design settings** (`theme.*`, `frontend.*`, `layout.*` and custom head/body HTML) follow the theme. Importing replaces the site's values, so a theme can switch the header off, hide search or change the colours even when the site's Settings have been saved before. Settings the previously imported theme (or starter site) set but this theme doesn't are cleared back to their defaults. Two exceptions: custom head/body HTML is only replaced while it's empty or unchanged since the last import, and the logo, favicon, `seo.title`, `seo.description` and `seo.og_image` are only filled in when the site has none. These are usually the owner's own.
- **Everything else** is applied only where the site doesn't already have a value, so importing demo content never overwrites what an admin has configured.

A theme only changes the design settings it lists. To carry a whole look, include every design setting that matters, not just the ones that differ from the defaults. The easiest way is to set the site up, take a settings-only backup and copy the `theme.*`, `frontend.*` and `layout.*` keys across. `seo.*` settings are validated the same way as on Admin → SEO: an unknown key or an invalid value is skipped rather than failing the import. Useful ones to ship:

```json
"settings": {
  "theme.dark_mode": "dark",
  "frontend.show_header": false,
  "seo.title": "My Site — what it does",
  "seo.description": "One or two sentences for search results.",
  "seo.og_image": "images/share.png",
  "seo.ai_crawlers": "block-training",
  "seo.social_profiles": ["https://github.com/you"],
  "seo.llms_intro": "Markdown shown at the top of /llms.txt.",
  "seo.indexnow_enabled": true
}
```

Don't include `seo.indexnow_key`, since each site generates its own when IndexNow is switched on. Leave out `seo.canonical_url` unless the theme is for one specific domain.

**Redirects** (`{ "from": "/old", "to": "/new", "statusCode": 301 }`, or `"to": ""` with `410`) are imported too. That's handy when a theme replaces an older site's URL structure.

**Menu items** must include `id`, `label`, `type`, `target`, and `children` — omitting any of these causes the Save button in the menu editor to fail silently after the demo is applied:

```json
"menus": [
  {
    "name": "Primary Navigation",
    "location": "header",
    "items": [
      {
        "id": "nav-001",
        "label": "Home",
        "type": "url",
        "url": "/",
        "target": "_self",
        "children": []
      },
      {
        "id": "nav-002",
        "label": "Blog",
        "type": "page",
        "slug": "blog",
        "target": "_self",
        "children": []
      }
    ]
  }
]
```

`type` must be `"url"` (for external links or absolute/relative paths) or `"page"` (for a content item looked up by `slug`). `location` can be `"header"`, `"footer"`, `"sidebar"`, or `null`.

---

## Developer Reference: Orders & Shop

### Money
Every shop table stores money as **whole minor units**: integers in pence or cents, or whole yen for zero-decimal currencies. These are exactly the numbers Stripe uses. The rules are in `shared/lib/money.ts` (`toMinorUnits`, `fromMinorUnits`, `formatMoney`, `currencyDecimals`). The older booking and pass columns hold decimals and are converted at the edges. Don't add a new decimal money column.

### Orders
`orders`, `order_lines` and `order_refunds` (`packages/db/src/schema/shop.ts`, `server/utils/orders.ts`) record every one-off payment: shop orders, card bookings, class passes and one-time membership tiers. To sell something new for money:

1. Make a pending order before going to Stripe, with `withPendingOrder()` (or `createOrder()`). A line's `kind` says what it is, `ref_id` what was bought, and `record_id` what buying it made (the booking, the holding, the subscription).
2. Put `metadata.nuxflowKind` and `metadata.orderId` on the Checkout session.
3. Handle that kind in `server/utils/booking-webhooks.ts`. `markOrderPaid()` is safe to run twice, because Stripe redelivers.
4. Give money back only through `refundPayment()`, with an idempotency key of your own. It records the refund against the order. `applyRefundToRecords()` is where what was bought follows a full refund.

`refunded_minor` is the larger of our own recorded refunds and the total Stripe last reported in `charge.refunded`, so refunds made here and in Stripe's dashboard never count twice.

### Products
A product is a content item of type `product`, with its shop data in the side tables `products` and `product_variants`, never as columns on `content_items`. The editor sends it as `product` on content POST/PATCH, and `planProductSave()` (`server/utils/products.ts`) turns it into batch statements.

- Variant ids are ULIDs made in the browser, so autosave can't create one twice.
- Stock is changed by difference (`stockWas`), never overwritten.

The pure rules (option combinations, stock messages, basket totals) are in `shared/lib/shop.ts`, with unit tests in `tests/unit/shop-rules.test.ts`.

Don't import `shared/lib` from `app/utils/*.ts` by a relative path. Typecheck and the unit tests pass, but the production build can't resolve it. Use `#shared/lib/…` in components and composables, or keep the util free of it.

### Checkout and stock
`server/utils/shop-checkout.ts`:

- Each line takes stock with one conditional `UPDATE … WHERE stock >= qty` and records it in `order_lines.stock_taken`.
- `releaseOrderStock()` gives it back. It claims each line in a statement that also requires the order to be unpaid, so a payment landing mid-sweep keeps its stock.
- The `shop-holds` task (every minute, on the partial index `idx_orders_pending_hold`) releases checkouts whose hold has run out.
- `settleShopOrder()` handles payment, including late payments that retake stock or are refunded.

Integration tests: `tests/integration/orders.test.ts`, `products.test.ts`, `shop-checkout.test.ts`.

### Downloads
`server/utils/shop-downloads.ts`. Files are stored at `_private/<siteId>/shop/<variantId>/…`, outside the public media route, and served by `server/routes/_nuxflow/download/[lineId].get.ts` with an HMAC token. The download count goes up in the same statement that checks the limit.

## Developer Reference: Multilingual & Events

### 1. Multilingual Serving & Backups
- **Routing Resolution:** The public route `server/api/public/pages/[...slug].get.ts` extracts optional locale prefixes (e.g. `/es/post-slug`). If a prefix is present, the handler queries `content_items` for the matching slug. If a translation is linked via `sourceItemId` for the requested locale, it is served; otherwise, it falls back to the original source item.
- **Header Swapper Integration:** The page returns `availableLocales: Array<{ locale, slug, rawSlug }>` which is loaded into `useState('active-locales')`.
- **Database Backup & Restoration Mappings:** The backup schema preserves translations using `locale` and `sourceItemSlug` (the parent slug). When applying a restore, NuxFlow stores the newly created SQLite ULIDs mapped by their slugs. After the initial database inserts, a second-pass routine runs to resolve the new parent `sourceItemId` foreign keys, preventing integrity constraint violations.

### 2. Events System Architecture
- **Schema Columns (`content_items`):**
  - `eventStartAt` (ISO-8601 string)
  - `eventEndAt` (ISO-8601 string)
  - `eventLocation` (text)
  - `eventUrl` (text)
  - `eventAllDay` (boolean flag)
  - `eventRsvpEnabled`, `eventRsvpCapacity`, `eventRsvpClosesAt`
  - `eventRecurrence` (repeat rule, as JSON; the stored start and end are the first date's)
  - `eventPrice`, `eventCurrency`, `eventCancelHours`, `eventPassesAllowed` (paid bookings and class passes)
- **Date format:** a timed event is a UTC instant, entered and shown in the site's time zone. An all-day event is its date at midnight UTC and is never converted between zones; its end is the last day, inclusive. All conversion is in `@nuxflow/canvas/events` (`packages/canvas/src/utils/event-dates.ts`), shared by the server, admin and block.
- **Attendees:** the `event_rsvps` table and `server/utils/event-rsvp.ts`. Each repeating date has its own list (`occurrence_date`). Class passes are in `class_passes` and `class_pass_holdings` (`server/utils/class-passes.ts`).
- **Database Indexes:** Query ranges are optimized using the composite index `idx_content_items_event_start` on `(site_id, event_start_at)`.
- **Public & iCal Feeds:**
  - `GET /api/public/events` returning list responses.
  - `GET /events.ics` returning standards-compliant iCal formatting (`VCALENDAR` and `VEVENT` blocks) for calendar client synchronization.
  - `GET /_nuxflow/event-ics/:id` returning one public event's calendar file.
- **Events Canvas Block:** The `CanvasBlockCalendar` block fetches through `CanvasHost.listEvents()`, a month at a time for the grid, and links to each event's page and calendar file.

