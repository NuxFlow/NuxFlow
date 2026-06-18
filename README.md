<p align="center">
  <img src=".github/assets/nuxflow-banner.png" alt="NuxFlow" width="720" />
</p>

<h3 align="center">The open-source CMS for the modern, edge-deployed web</h3>

<p align="center">
  Built on Nuxt 4 · Cloudflare Workers
</p>

<p align="center">
  <a href="https://github.com/NuxFlow/NuxFlow/actions/workflows/ci.yml">
    <img src="https://github.com/NuxFlow/NuxFlow/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" />
  </a>
  <a href="https://github.com/NuxFlow/NuxFlow/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  </a>
  <img src="https://img.shields.io/badge/nuxt-4-00DC82?logo=nuxt.js" alt="Nuxt 4" />
  <img src="https://img.shields.io/badge/cloudflare-workers-F38020?logo=cloudflare" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/turso-libSQL-4FF8D2" alt="Turso" />
  <img src="https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm" alt="pnpm workspace" />
</p>

> **Beta software.** NuxFlow is under active development. The core feature set is stable but breaking changes may still occur between releases. Suitable for early adopters and non-critical production sites — a stable `1.0` release will follow once the API surface is locked. Feedback and contributions are very welcome.

---

NuxFlow is a self-hosted, open-source CMS that gives non-technical editors a WordPress-level visual page-building experience, engineered specifically for the serverless **Cloudflare Workers edge ecosystem** (with Turso/libSQL fallback). 

By optimizing strictly for Cloudflare Workers instead of legacy VPS hosting or complex AWS cloud architectures, NuxFlow delivers a **zero-configuration, zero-cold-start, and virtually free-to-host CMS** capable of serving pages globally in under 15ms.

**For users:** A guided onboarding wizard, a drag-and-drop Canvas page builder, media library, multi-step forms, and an intuitive admin dashboard — all with zero database configuration or server setups.

**For developers:** A fully typed Nuxt 4 monorepo with Drizzle ORM, a typed REST + GraphQL API, a plugin SDK, and a secure, cryptographically signed dynamic plugin sandbox powered exclusively by Cloudflare's Dynamic Workers.

---

## Features

### Canvas Visual Page Builder
- **Elementor-style drag-and-drop editor** — build pages visually without writing code
- **Built-in block types**: Hero, Text, Image, Video, Columns, Features, Testimonial, CTA Banner, Spacer, GDPR Banner, Footer, Button, Accordion, Pricing Table
- **Third-party blocks** — install dynamic plugins to add new block types (Countdown, Pricing Table, Map, etc.)
- **State-driven editing** — every property change updates live JSON, saved with a single API call
- **Fully server-side rendered** — canvas pages are SSR'd at the edge for instant first paint and SEO

### Rich Text Content
- **Prose editor** powered by TipTap for rich text editing (WYSIWYG layout)
- **Formatting options**: Paragraph, Headings (H1–H3), Bold, Italic, Underline, Strikethrough, Highlight, Inline/Block Code, Ordered/Unordered Lists, Blockquote, Divider, Images, Links, and Tables
- **Content types**: Pages, Posts, custom types defined per site
- **Workflow states**: Draft → Pending Review → Scheduled → Published → Archived
- **Revision history** — point-in-time snapshots with preview and one-click restore
- **Scheduled publishing** — automatic publish at a set time, respects site timezone
- **Shareable preview links** — 48-hour signed URL, no login required
- **Auto-save** — debounced 10-second background save on existing items
- **Content taxonomies** — tags, categories, and admin-defined custom taxonomies
- **Multi-language** — per-item locale assignment via `@nuxtjs/i18n`

### Media Management & Video Streaming
- **Drag-and-drop upload** to the media library
- **Provider abstraction** — Cloudflare Images (default), AWS S3 / Backblaze B2, and Bunny.net (configured via environment variables)
- **Alt text and caption** editor per asset
- **Responsive image delivery** via Cloudflare Images variants
- **Media picker** component embedded in the block editor
- **Cloudflare Stream Integration** — direct browser-to-edge resumable uploads (TUS protocol), background HLS/DASH transcoding, and interactive analytics tracking


### Authentication & Users
- Email/password login with secure hashing via **Better Auth**
- **Social login** — Google and GitHub OAuth
- **Passkey / Passwordless login** — register and authenticate with biometrics (Touch ID, Face ID) or hardware keys via WebAuthn
- **Role-based access control**: Super Admin, Admin, Editor, Author, Viewer, plus custom roles
- **Multi-site roles** — users can have different roles on different sites
- Password reset via email (24-hour links)
- User invitation workflow with role assignment

### Site Settings & SEO
- **Per-item SEO** — meta title, description, canonical URL, Open Graph, Twitter Card, Schema.org structured data
- **Auto-generated XML sitemap** at `/sitemap.xml`
- **Dynamic robots.txt** — toggle index/noindex settings from the admin
- **301/302 redirect manager** — create and delete redirects from the admin
- **Analytics integration** — setting field for Google Analytics ID (to be wired in theme templates)
- **RSS/Atom feed** at `/feed.xml`

### Forms Builder
- **Multi-step form builder** (Typeform-style)
- **Field types**: Text, Number, Email, File Upload, Select, Radio, Checkbox, Date, Signature, Computed
- **Conditional logic** — "Show field if X equals Y"
- **Computed fields** — real-time expression evaluation (e.g. `{{quantity}} * {{price}}`)
- **Spam protection** via Cloudflare Turnstile
- Submissions stored in database; viewable and **exportable as CSV**
- Optional email notification on submission

### Theme System & Visual Customizer
- **Visual Customizer** — full-screen, no-code style editor with a side-by-side live preview of your site; change fonts (17 Google Fonts), colours, backgrounds, spacing density, content width, and corner radius in real time, then publish with one click
- **Site logo** — upload a logo image (PNG/SVG/WebP) to replace the text site name in the public header; managed from Settings → Appearance
- **Custom code injection** — inject analytics tags, chat widgets, or any HTML into `<head>` or `<body>` of every public page via Settings → Appearance, with no redeploy required
- Themes are **Nuxt layers** — override any component, page, or layout
- **Live theme preview** — admin sees new theme while visitors see the current one
- **Instant activation** — new theme takes effect immediately on activation
- Per-block render components defined in the theme
- CLI scaffolding: `npx nuxflow create-theme`

### Membership & Payments
- **Membership tiers** with recurring subscription pricing
- **Auto-sync** — saving a tier automatically creates the matching product and price in your configured provider(s); no manual setup in the provider dashboard required
- **Content access gating** — per-page: Public / Members Only / Specific Tier
- **Paywall component** shown to visitors who lack access
- Payment processors: **Stripe**, **Lemon Squeezy**, **Paddle** (configure one or all three simultaneously)
- **Cancel subscription** — members cancel from `/account` for all providers; Stripe members can also open the Customer Portal for invoice history and payment method updates
- Webhook handlers for full subscription lifecycle (created, updated, cancelled, expired)
- Subscriber management admin page

### Plugin System
- **Two tiers**: bundled plugins (ship with NuxFlow) and dynamic third-party plugins
- **Dynamic plugins** run as isolated **Cloudflare Worker instances** — code is uploaded to KV and spawned on demand with zero redeployment
- **Ed25519 code signing** — every plugin must be signed with the author's private key; the server verifies the signature and SHA-256 checksums on install and on every request, blocking tampered code before it executes
- **Canvas blocks** — dynamic plugins can register new block types that appear in the page builder immediately after install
- **CLI toolchain** — `nuxflow plugin keygen` · `nuxflow plugin build` · `nuxflow plugin deploy`
- No bundled plugins — all built-in features (Canvas blocks, Contact Forms, Memberships, HTML embeds) are part of core NuxFlow

### Multi-Site Management
- One installation manages **unlimited sites** with full data isolation
- Per-site domain, theme, plugins, users, and content
- All database queries scoped by `site_id`
- **Super-admin dashboard** with cross-site stats
- Site creation wizard

### AI Writing Assistant
- LLM providers: **OpenAI**, **Anthropic**, **Google Gemini**, **DeepSeek**, **Ollama** (local, free)
- **Improve** — select text → receive 2–3 alternative rewrites
- **SEO suggestions** — generate meta title and description from content
- **Alt text generation** for media uploads
- AI toolbar only appears when a provider is configured — zero friction when unused

### REST & GraphQL API
- **REST API v1** — full CRUD on all content types, paginated and filterable
- **GraphQL API** — `graphql-yoga` endpoint at `/api/graphql`
- **API keys** — generate named keys with scoped permissions, revoke anytime
- Bearer token authentication for external consumers
- Unauthenticated requests automatically restricted to published content

### Operations & Developer Experience
- **In-app notifications** — bell icon in admin header for publish, submission, comment events
- **Audit log** — full history of admin actions (who, what, when)
- **Webhook dispatcher** — fires on `content.publish`, `form.submission`, `user.created`
- **Full-text search** — SQLite FTS5, zero external dependency
- **Content export** — JSON or CSV download
- **Maintenance mode** — toggle from settings; shows a customisable holding page
- **Rate limiting** — DB-backed atomic upsert (works across Cloudflare Worker isolates)
- **GDPR cookie consent banner** — simple opt-in/opt-out consent banner for compliance
- **Comment system** — native threaded comments with auto-approval for logged-in users and moderation queue for guests
- Scheduled cron task — auto-publishes scheduled content every minute
- CSRF protection, input validation (Zod), security headers

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Nuxt 4 |
| Runtime | Cloudflare Workers (via Nitro `cloudflare-module` preset) |
| Database | Cloudflare D1 (default) · Turso / libSQL (alternative) |
| ORM | Drizzle ORM |
| UI | Nuxt UI Pro (TipTap `UEditor`, `UDashboardSidebar`) |
| Auth | Better Auth + `@onmax/nuxt-better-auth` |
| State | Pinia |
| GraphQL | graphql-yoga |
| Validation | Zod |
| Animations | Motion Vue |
| i18n | @nuxtjs/i18n |
| SEO | nuxt-seo-utils |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest + Playwright |

---

## Project Structure

```
nuxflow/
├── apps/nuxflow/               # Main Nuxt 4 application
│   ├── app/
│   │   ├── pages/admin/        # Admin dashboard pages
│   │   ├── pages/setup/        # Onboarding wizard
│   │   ├── components/         # Editor, forms, media, setup components
│   │   ├── layouts/            # Admin + public layouts
│   │   └── stores/             # Pinia stores (auth, content, site)
│   └── server/
│       ├── api/v1/             # REST API handlers
│       ├── api/graphql/        # GraphQL endpoint
│       ├── middleware/         # Site resolution, auth, redirects, maintenance
│       ├── plugins/            # Plugin loader, theme resolver
│       ├── routes/             # sitemap.xml, robots.txt, feed.xml
│       ├── scheduled/          # Cron tasks (scheduled publish)
│       └── utils/              # Permissions, audit, rate limiting, providers
├── packages/
│   ├── db/                     # Drizzle schema + migrations + client factory
│   ├── plugin-sdk/             # Types and helpers for plugin authors
│   └── cli/                    # create-plugin and create-theme scaffolding
├── packages/plugins/
│   └── canvas/                 # Canvas page builder (block components + editor)
├── themes/
│   └── default/                # Default theme (Nuxt layer, block renderers)
└── specs/001-nuxflow-cms-platform/  # Specification, data model, API contracts
```

---

## Documentation

For detailed information on how to install and use NuxFlow, please refer to our documentation:

- **[Installation Guide](docs/installation.md)** — Step-by-step setup for local development and Cloudflare deployment.
- **[User Guide](docs/user-guide.md)** — A comprehensive manual for managing content and site settings.
- **[Payments & Memberships Setup](docs/payments-setup.md)** — Configure Stripe, Lemon Squeezy, or Paddle; set up webhooks; gate content.
- **[Documentation Index](docs/index.md)** — The entry point for all documentation.

---

## Getting Started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | `nvm install 20` |
| pnpm | 9+ | `npm install -g pnpm` |
| Wrangler | 4+ | `pnpm add -g wrangler` |

### 1. Clone and install

```bash
git clone https://github.com/NuxFlow/NuxFlow.git
cd nuxflow
pnpm install
```

### 2. Copy Wrangler Configuration

NuxFlow uses Wrangler for local development and deployment. Copy the example wrangler configuration inside the app folder:

```bash
cp apps/nuxflow/wrangler.toml.example apps/nuxflow/wrangler.toml
```

### 3. Configure the database

NuxFlow uses **Cloudflare D1** by default (recommended). A local SQLite file via Turso is available as a zero-account alternative for development.

**Option A — Cloudflare D1 (recommended)**

```bash
wrangler login
wrangler d1 create nuxflow-dev
```

Copy the returned `database_id` into `apps/nuxflow/wrangler.toml` under `[[d1_databases]]`.

> **Note:** Migrations are applied automatically on the first request. If you prefer to seed the local database manually before starting the dev server:
> ```bash
> cd apps/nuxflow
> wrangler d1 execute nuxflow-dev --local --file=../../packages/db/migrations/0000_baseline.sql
> ```

**Option B — Local SQLite file (no Cloudflare account required)**

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash
turso db create nuxflow-dev
turso db show nuxflow-dev --url       # copy the URL
turso db tokens create nuxflow-dev    # copy the token
```

Then set `NUXT_TURSO_URL` and `NUXT_TURSO_AUTH_TOKEN` in your `.env` file and remove the `[[d1_databases]]` block from `wrangler.toml`.

### 4. Configure environment

```bash
cp apps/nuxflow/.env.example apps/nuxflow/.env
```

Minimum required variables:

```env
NUXT_BETTER_AUTH_SECRET=at-least-32-random-characters
NUXT_PUBLIC_SITE_URL=http://localhost:3000
```

See [Environment Variables](#environment-variables) for the full reference.

### 5. Start the dev server

```bash
pnpm dev
```

Open `http://localhost:3000/setup` — the onboarding wizard walks through the remaining configuration. Once completed, your admin control panel is permanently accessible at `http://localhost:3000/admin`.

---

## Deployment

### Cloudflare Workers

> [!IMPORTANT]
> **Local Build Requirements:**
> Even when deploying straight to Cloudflare, the build compilation runs on your local machine before upload. You **must** do the following before running `pnpm build`:
> 1. **Install Dependencies:** If you skipped local dev, run `pnpm install` in the root folder.
> 2. **Local `.env` File:** Copy the example configuration (`cp apps/nuxflow/.env.example apps/nuxflow/.env`) to satisfy build-time schemas.

```bash
# Log in to Cloudflare
wrangler login

# Create the D1 database and copy the returned database_id into wrangler.toml
wrangler d1 create nuxflow

# Create the dynamic plugin/theme KV namespaces and copy the returned ids into wrangler.toml
wrangler kv namespace create PLUGIN_KV
wrangler kv namespace create PLUGIN_KV --preview

# Migrations run automatically on the first request after deployment.
# To seed manually before the first deploy:
# wrangler d1 execute nuxflow --remote --file=../../packages/db/migrations/0000_baseline.sql

# Set secrets
wrangler secret put NUXT_BETTER_AUTH_SECRET

# Build and deploy — pnpm deploy builds automatically, no separate pnpm build needed
pnpm deploy
```

The `wrangler.toml` in `apps/nuxflow/` is preconfigured with the `nodejs_compat` compatibility flag, the KV namespace for dynamic plugins, the WorkerLoader binding, and the scheduled cron trigger for auto-publishing.

### Why Exclusively Cloudflare Workers?

Unlike traditional CMS platforms built for legacy VPS servers or complex AWS infrastructures, NuxFlow is built from the ground up to utilize Cloudflare's edge capabilities:
- **Zero Cold Starts**: Served instantly from Cloudflare's global edge runtime.
- **Edge Sandboxing**: Sandboxed plugin modules are hot-loaded at the edge using the native **Cloudflare Dynamic Workers API** (`WorkerLoader`), a feature not natively available on AWS Lambda or general Node servers.
- **D1 & KV Cache**: Database read/writes are replicated globally on D1 SQLite bindings with KV asset speed.

---

## Environment Variables

Most variables are prefixed `NUXT_` (except direct provider envs like `S3_*` or `BUNNY_*`) and set in `apps/nuxflow/.env` (development) or your hosting provider's secret store (production).

| Variable | Required | Description |
|---|---|---|
| `NUXT_TURSO_URL` | | Turso/libSQL alternative to D1: `libsql://your-db.turso.io` or `file:../../packages/db/local.db` |
| `NUXT_TURSO_AUTH_TOKEN` | | Turso JWT token. Not needed for local `file:` URL. |
| `NUXT_BETTER_AUTH_SECRET` | ✅ | Session signing secret — minimum 32 characters |
| `NUXT_PUBLIC_SITE_URL` | ✅ | Full URL including scheme, used in emails and SEO |
| `NUXT_EMAIL_PROVIDER` | | `console` (default) · `resend` · `brevo` · `zepto` · `smtp` |
| `NUXT_RESEND_API_KEY` | | Resend API key (`re_…`) |
| `NUXT_BREVO_API_KEY` | | Brevo API key (`xkeysib-…`) |
| `NUXT_ZEPTO_API_KEY` | | ZeptoMail API key |
| `NUXT_SMTP_HOST` | | SMTP server hostname |
| `NUXT_SMTP_PORT` | | SMTP port (default `587`) |
| `NUXT_SMTP_USER` | | SMTP username |
| `NUXT_SMTP_PASS` | | SMTP password |
| `NUXT_CLOUDFLARE_IMAGES_TOKEN` | | Cloudflare Images API token |
| `NUXT_CLOUDFLARE_ACCOUNT_ID` | | Cloudflare account ID |
| `NUXT_CLOUDFLARE_IMAGES_DELIVERY_URL` | | Image delivery base URL |
| `NUXT_CLOUDFLARE_STREAM_TOKEN` | | Cloudflare Stream API token |
| `NUXT_PUBLIC_CLOUDFLARE_IMAGES_DELIVERY_URL` | | Same value, exposed to the client |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | | Cloudflare Turnstile public site key |
| `S3_BUCKET` | | S3 media provider — bucket name (setting this enables S3) |
| `S3_ACCESS_KEY` | | S3 media provider — access key ID |
| `S3_SECRET_KEY` | | S3 media provider — secret access key |
| `S3_REGION` | | S3 media provider — region (default `us-east-1`) |
| `S3_ENDPOINT` | | S3 media provider — custom endpoint URL (e.g. for Backblaze B2, R2) |
| `S3_PUBLIC_URL` | | S3 media provider — public CDN/delivery URL |
| `BUNNY_API_KEY` | | Bunny.net media provider — API key (setting this enables Bunny.net) |
| `BUNNY_STORAGE_ZONE` | | Bunny.net media provider — storage zone name |
| `BUNNY_PULL_ZONE` | | Bunny.net media provider — pull zone subdomain |
| `NUXT_STRIPE_SECRET_KEY` | | Payments — Stripe secret key |
| `NUXT_STRIPE_WEBHOOK_SECRET` | | Payments — Stripe webhook signing secret |
| `NUXT_LS_API_KEY` | | Payments — Lemon Squeezy API key |
| `NUXT_LS_STORE_ID` | | Payments — Lemon Squeezy store ID |
| `NUXT_LS_WEBHOOK_SECRET` | | Payments — Lemon Squeezy webhook secret |
| `NUXT_PADDLE_API_KEY` | | Payments — Paddle API key |
| `NUXT_PADDLE_VENDOR_ID` | | Payments — Paddle vendor ID |
| `NUXT_PADDLE_WEBHOOK_PUBLIC_KEY` | | Payments — Paddle Ed25519 public key |

---

## Development Commands

```bash
# Dev server (localhost:3000)
pnpm dev

# Run all unit tests
pnpm test

# Run unit tests in watch mode
pnpm test:watch

# Run end-to-end tests (requires running dev server)
pnpm test:e2e

# TypeScript type-check (all packages)
pnpm typecheck

# Lint
pnpm lint

# Production build
pnpm build

# Preview production build locally
pnpm preview

# Deploy to Cloudflare
pnpm deploy

# Run DB migrations
pnpm --filter @nuxflow/db migrate
```

---

## Plugins

Plugins extend NuxFlow with new server routes, admin pages, and UI components. They declare their required permissions upfront; an admin must approve them before activation.

### Creating a dynamic plugin

Dynamic plugins are standalone packages built and deployed independently from NuxFlow itself. The CLI handles the full lifecycle.

```bash
# Scaffold a new plugin project
nuxflow plugin create

# Generate your Ed25519 publisher keypair (do this once — keep the private key secret)
nuxflow plugin keygen

# Build (compiles server Worker + client bundle, computes SHA-256 checksums)
nuxflow plugin build

# Deploy to a NuxFlow site
nuxflow plugin deploy --site https://your-site.com --email admin@example.com --password ••••

# Push an update
nuxflow plugin update --site https://your-site.com --email admin@example.com --password ••••
```

The server verifies the Ed25519 signature and SHA-256 checksums on install and on every request. Code that fails verification is rejected before execution.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full plugin authoring guide including how to register Canvas block types with a field schema.

---

## Themes & Visual Customizer

### Visual Customizer

The Visual Customizer is a no-code, full-screen style editor built into the admin dashboard. Open it from **Admin → Themes → Open customizer**.

The left panel gives you point-and-click controls for:

- **Colour scheme** — Auto (follows each visitor's OS), Light, or Dark
- **Accent colour** — colour picker + hex input + quick swatches, injected as `--nuxflow-primary`
- **Link colour** — defaults to accent; independently overridable
- **Page background** — separate light-mode and dark-mode background colours with quick presets
- **Body & heading fonts** — 17 Google Fonts across sans-serif, serif, and monospace families
- **Font size** — XS / SM / MD / LG / XL step scale
- **Heading weight** — Light through Extra Bold
- **Line spacing** — Tight / Normal / Relaxed
- **Corner radius** — None through Pill, with visual previews
- **Section spacing** — Compact / Normal / Spacious, scales the vertical padding between page sections
- **Content width** — Narrow (720 px) / Default (960 px) / Wide (1200 px) / Full

The right panel shows a live iframe preview of your actual site, updating as you change controls (300 ms debounce). Use the device toggle to switch between Desktop, Tablet, and Mobile viewports. Click **Publish** to write the generated CSS to a managed theme and activate it instantly.

### Themes (Nuxt layers)

Themes are [Nuxt layers](https://nuxt.com/docs/guide/going-further/layers) — they can override any component, page, layout, or asset. The active theme is loaded per request; switching themes is instant and does not affect live visitors until Activate is clicked.

### Default theme

`themes/default/` includes block renderer components for every built-in block type. Fork it to create your own theme.

### Creating a theme

```bash
npx nuxflow create-theme my-theme
```

---

## Contributing

Contributions of all kinds are welcome — bug fixes, features, documentation, and plugin/theme submissions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide including branch naming, commit conventions, and how to submit a pull request.

---

## Security

Found a vulnerability? Please do not open a public issue. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.

---

## License

MIT — see [LICENSE](LICENSE).
