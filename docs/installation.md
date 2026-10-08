# Installation Guide

NuxFlow runs on Cloudflare Workers with **Cloudflare D1** as the database. D1 is SQLite at the edge — no separate account, no credentials to manage, everything lives inside your Cloudflare account.

## Quick Start

The fastest way to get a new NuxFlow site running is the scaffolder — it handles cloning, dependency installation, secret generation, and `.env` setup in one step:

```bash
pnpm create nuxflow-app@beta
```

> Also works with `npm create nuxflow-app@beta` or `pnpm dlx create-nuxflow-app@beta`.
>
> The `@beta` tag is required while NuxFlow is in pre-release. It will be dropped once a stable `1.0` is published.


The scaffolder clones the project, installs dependencies, and creates `wrangler.toml` and a local `.env` with a generated secret. It does **not** create anything on Cloudflare. To go live, continue from [2. Cloudflare Deployment](#2-cloudflare-deployment). The sections below cover every step in detail if you'd rather set things up by hand or want to contribute to NuxFlow itself.

> [!IMPORTANT]
> **A site that loads isn't necessarily set up properly.** NuxFlow is designed to start working even when some pieces are missing. For example, without file storage it keeps images inside the database, and without an email provider it quietly doesn't send emails. Once your site is up, work through the **[After-installation checklist](#5-after-installation-checklist)** at the end of this guide. It takes about 15 minutes.

---

## Prerequisites

Install the following tools before you begin:

- **Node.js** 22 or higher
- **pnpm** 9 or higher — `npm install -g pnpm`
- **Wrangler** v4 (Cloudflare CLI). It's already a project dependency, so after `pnpm install` you can run it as `pnpm exec wrangler …` from `apps/nuxflow`. This guide writes commands as plain `wrangler …`: either install it globally (`pnpm add -g wrangler`) or put `pnpm exec` in front.
- A **Cloudflare Workers Paid plan** ($5/month minimum) — NuxFlow requires this to run at all, not just for optional features like dynamic plugins. The Free plan's CPU time limit is too tight for a full Nuxt SSR CMS.

---

## 1. Local Development

### Clone the Repository

```bash
git clone https://github.com/NuxFlow/NuxFlow.git
cd NuxFlow
pnpm install
```

### Copy Wrangler Configuration

NuxFlow uses Wrangler for local development and edge deployment. Copy the example wrangler config file inside the app folder:

```bash
cp apps/nuxflow/wrangler.toml.example apps/nuxflow/wrangler.toml
```

### Create a Local `.env`

The local dev server needs an auth secret, which `wrangler dev` reads from `apps/nuxflow/.env`:

```bash
cp apps/nuxflow/.env.example apps/nuxflow/.env
```

Replace the `NUXT_BETTER_AUTH_SECRET` placeholder with a random value of at least 32 characters, for example the output of:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> [!NOTE]
> **`.env` is only for local development.** Nothing in it is uploaded when you deploy, and the build doesn't need it. Your live site gets its secret from Cloudflare instead ([Step 6](#step-6-add-the-auth-secret)). Use a **different** secret there.

### Start the Dev Server

`wrangler dev` creates a local D1 database (and local KV and R2) automatically, so there's nothing to create on Cloudflare for local development.

Start the dev server from the `apps/nuxflow` directory:

```bash
cd apps/nuxflow
wrangler dev
```

`pnpm dev` from the repository root does the same thing — `wrangler dev` is the only supported local development workflow; there is no separate `nuxt dev` path.

Each start builds the Nuxt app first (a minute or two), because the `[build]` command in `wrangler.toml` runs every time. To pick up source code changes, stop the server and start it again.

Database migrations run automatically on the first request. Visit `http://localhost:8787/setup` to complete the onboarding wizard. Once setup is complete, you can access your admin dashboard at `http://localhost:8787/admin`.

::note
**How migrations work:** NuxFlow bundles all database migration files into the deployed Worker. On the very first request after a fresh install or an upgrade, any migrations that have not yet been applied are executed automatically. A `_nuxflow_migrations` table in your database tracks which files have already run, so no migration is ever applied twice. You never need to run a migration command manually.
::

---

## 2. Cloudflare Deployment

NuxFlow deploys as a **Cloudflare Worker** using the `cloudflare-module` Nitro preset. The `wrangler.toml` in `apps/nuxflow` is pre-configured with D1 as the default database.

> [!IMPORTANT]
> **Before deploying, make sure you have:**
> 1. **Installed dependencies:** if you skipped the local development steps, run `pnpm install` from the repository root first.
> 2. **`apps/nuxflow/wrangler.toml`:** if you skipped local development, create it with `cp apps/nuxflow/wrangler.toml.example apps/nuxflow/wrangler.toml`.
> 3. **A Workers Paid plan** ($5/month minimum) on the Cloudflare account you're deploying to — see [Prerequisites](#prerequisites). Argon2id password hashing (~150-175ms per hash) and normal Nuxt SSR rendering both need more CPU time than the Free plan's 10ms budget allows.
>
> You do **not** need a `.env` file to deploy. Only the local dev server reads it; the live site's secret is added in [Step 6](#step-6-add-the-auth-secret).

Run every command in this section from the `apps/nuxflow` directory.

### Step 1: Log In to Cloudflare

```bash
wrangler login
```

This opens a browser window to authenticate your Cloudflare account.

### Step 2: Create the D1 Database

```bash
cd apps/nuxflow
wrangler d1 create nuxflow
```

Wrangler prints a `database_id`. If it offers to add the binding to your config for you, you can accept, but check the result matches the block below: the binding name must be `"DB"`. Open `apps/nuxflow/wrangler.toml` and paste it into the `[[d1_databases]]` block:

```toml
[[d1_databases]]
binding = "DB"
database_name = "nuxflow"
database_id = "YOUR_DATABASE_ID_HERE"
```

### Step 3: Create the KV Namespace

NuxFlow uses a Cloudflare KV namespace to store dynamic plugin bundles and active theme stylesheets. You **must** create these before deploying.

Run these two commands from the `apps/nuxflow` directory (the first creates your production namespace, the second creates a local preview namespace):

```bash
wrangler kv namespace create PLUGIN_KV
wrangler kv namespace create PLUGIN_KV --preview
```

Wrangler will print a snippet for each command containing an `id` value. Copy and paste these into the `[[kv_namespaces]]` block in `apps/nuxflow/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "PLUGIN_KV"
id = "YOUR_KV_ID_FROM_FIRST_COMMAND"
preview_id = "YOUR_PREVIEW_ID_FROM_SECOND_COMMAND"
```

### Step 4: Create the R2 Bucket for Media

`wrangler.toml` already declares an R2 bucket for uploaded images and files, and a deploy fails if that bucket doesn't exist yet. Create it once:

```bash
wrangler r2 bucket create nuxflow-media
```

There's nothing else to configure. Uploads are stored in the bucket and served from your site at `/_nuxflow/media/...`. See [Media Storage](#media-storage) for alternatives.

### Step 5: Build and Deploy

```bash
pnpm run deploy
```

This builds the app and uploads it to Cloudflare in one step, so you don't need a separate build command. The `[build]` section in `wrangler.toml` tells Wrangler to compile the Nuxt app first.

Wrangler prints your Worker's address, e.g. `https://nuxflow.<your-subdomain>.workers.dev`. **Don't open it yet.** It has no auth secret until the next step.

Database migrations run automatically on the first request. There is nothing else to run.

### Step 6: Add the Auth Secret

Generate a new random secret. Don't reuse the one in your local `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Store it on Cloudflare. Wrangler asks you to paste the value, so it never ends up in your shell history:

```bash
wrangler secret put NUXT_BETTER_AUTH_SECRET
```

Keep a copy in your password manager. This secret signs every login and encrypts the API keys you save in Settings, so changing it later signs everyone out and makes those saved keys unreadable (see [checklist item 4](#-4-keep-your-auth-secret-safe-and-never-change-it)).

Secrets take effect immediately and stay in place across future deploys, so you only set this once. You can also manage secrets in the Cloudflare dashboard under **Workers & Pages → nuxflow → Settings → Variables and Secrets**.

::note
**Where each kind of value lives:** secrets (like this one) are stored on Cloudflare with `wrangler secret put` or in the dashboard. Non-secret settings (bindings, `[vars]`) go in `wrangler.toml`. `.env` is only read by the local dev server and is never deployed.
::

::note
D1 does not require any secrets. The database connection is handled automatically through the `DB` binding declared in `wrangler.toml`.
::

### Step 7: Run the Setup Wizard

Open `https://<your-worker-address>/setup` **straight away** and complete the wizard. On a fresh install, whoever finishes it first becomes the site's owner and super admin, and the address is public, so don't leave a new deploy sitting un-set-up.

After that, your admin dashboard is at `/admin`.

### Step 8: Add a Custom Domain

By default Cloudflare assigns a `*.workers.dev` subdomain. To use your own domain:

1. Open **Workers & Pages → nuxflow → Settings → Domains & Routes**
2. Click **Add** → **Custom Domain**
3. Enter your domain or subdomain (e.g. `cms.yourdomain.com`)
4. Cloudflare creates the DNS record and provisions a TLS certificate automatically

Your domain must be on Cloudflare's nameservers for this to work. If it is not, use a **Route** instead and point the DNS record manually.

This is right for a **single** site. Before you add a sign-in domain (`accounts.…`) or more sites under the same domain, switch to the wildcard Routes setup in [Multi-site → Pointing a domain at the Worker](./multi-site.md#pointing-a-domain-at-the-worker): several Custom Domains under one domain cause intermittent, unlogged `403` errors.

Also declare the domain in `wrangler.toml`. Otherwise every later deploy warns that the dashboard and your config disagree, and offers to remove the domain:

```toml
[[routes]]
pattern = "cms.yourdomain.com"
custom_domain = true
```

Then sign in to the admin **on the new domain**. With a single site, NuxFlow notices the new address and updates the site's stored domain, so links in emails, feeds, and sitemaps use it.

### Step 9: Verify Cron Triggers

NuxFlow runs scheduled jobs for timed publishing, nightly cleanup, and stuck-video checks. The triggers are defined in `wrangler.toml`:

```toml
[triggers]
crons = ["* * * * *", "0 3 * * *", "0 * * * *"]
```

- Every minute: publish scheduled content.
- Nightly at 3 AM UTC: prune old logs and revisions, and flag stale content.
- Hourly: mark failed video uploads.

After deploying, confirm all three are active in **Workers & Pages → nuxflow → Settings → Triggers → Cron Triggers**.

To test the scheduled handler locally (run from `apps/nuxflow`):

```bash
wrangler dev --test-scheduled
```

Then call `http://localhost:8787/__scheduled` to trigger it manually.

> [!TIP]
> Your site is live. Before you start adding content, go through the **[After-installation checklist](#5-after-installation-checklist)**.

---

## 3. Automated Deploys via GitHub

Connecting NuxFlow to GitHub lets Cloudflare rebuild and redeploy your site automatically every time you push. This section explains the recommended setup and the exact settings to enter in the Cloudflare dashboard.

### Fork the Repository First

Rather than connecting Cloudflare directly to the `NuxFlow/NuxFlow` repository, we strongly recommend creating your own fork on GitHub first.

Deploying from a fork means you control when upstream updates are pulled in, so a new NuxFlow release never lands on your live site without your review. It also gives you a place to add site-specific customisations and to run a staging environment — for example, a second Cloudflare Worker connected to the same fork's `staging` branch — before changes reach production.

To fork:

1. Go to [github.com/NuxFlow/NuxFlow](https://github.com/NuxFlow/NuxFlow) and click **Fork**
2. Clone your fork and use it as the basis for your deployment

### Commit Your `wrangler.toml` to the Fork

Cloudflare's build reads `apps/nuxflow/wrangler.toml` from your repository, but the NuxFlow repo ignores that file (it holds each installation's own IDs). In your fork, remove the `apps/nuxflow/wrangler.toml` line from `.gitignore` and commit your filled-in copy, with the D1, KV, and R2 settings from [Cloudflare Deployment](#2-cloudflare-deployment). Those IDs aren't secrets. Never put secrets in this file; they stay in Cloudflare (see [Step 6](#step-6-add-the-auth-secret)).

Do the one-time Cloudflare setup from [Cloudflare Deployment](#2-cloudflare-deployment) first (Steps 1–7, deploying once by hand), then connect Git for later deploys.

### Connect Your Fork to Cloudflare

1. Open **Workers & Pages → nuxflow → Settings → Build**
2. Under **Git repository**, click **Connect to Git**
3. Authorise Cloudflare to access your GitHub account and select your fork
4. Choose the branch to deploy (typically `main`)

### Build Settings

Enter the following values in the **Build configuration** section:

| Setting | Value |
|---|---|
| **Root directory** | `apps/nuxflow` |
| **Build command** | `pnpm install && NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo build --filter @nuxflow/app` |
| **Deploy command** | `pnpm --filter @nuxflow/app run deploy` |

The root directory tells Cloudflare where to find `wrangler.toml` for the deploy step. The build command still runs from the repository root regardless of this setting, which is why the Turbo filter works correctly.

The `NODE_OPTIONS` prefix increases the Node.js heap limit to 4 GB. Cloudflare's build environment defaults to roughly 2 GB, which is not enough for Nitro's bundling phase in a monorepo.

### Environment Variables

**None are needed for the build.** NuxFlow reads all its settings and secrets when the site runs, not when it's built. The secrets you added with `wrangler secret put` stay on the Worker across every automated deploy, so leave **Settings → Build → Environment variables** empty.

::note
Don't copy secrets into the build environment variables "just in case". They aren't used there, and it's one more place a secret can leak from.
::

::note
After saving the build configuration, push a commit to your connected branch to trigger the first automated build. Subsequent pushes to that branch will deploy automatically.
::

---

## 4. Additional Configuration

All `wrangler secret put` commands in this section must be run from the `apps/nuxflow` directory.

### AI Discoverability (GEO / LLMO)

NuxFlow ships several AI-discoverability features out of the box — no configuration required:

| Endpoint | What it does |
|---|---|
| `/llms.txt`, `/llms-full.txt` | Markdown index (and full text) of your site for ChatGPT, Claude, Perplexity, and other assistants |
| `/<page>.md` or `Accept: text/markdown` | A clean Markdown version of any page, for AI agents |
| `/sitemap.xml`, `/sitemap-images.xml` | Indexable pages with `lastmod`, hreflang alternates, and each page's images |
| `/robots.txt` | Generated from Admin → SEO, including a `Content-Signal` line |
| `/atom.xml` | Atom 1.0 feed (alongside RSS 2.0 at `/feed.xml`) with author and image metadata |
| JSON-LD | `BlogPosting` / `Event` / `WebPage`, `FAQPage`, `BreadcrumbList`, `Organization`, and `WebSite` |

**To control AI crawler access**, go to **Admin → SEO → AI & crawlers** after deploying. Choose between allowing all AI crawlers, blocking AI *training* while still allowing AI search and answers (recommended), or blocking every AI crawler. No redeploy is needed.

**Cloudflare-side settings to check:** in the Cloudflare dashboard, **AI Crawl Control → Block AI bots** and **Managed robots.txt** act before requests reach NuxFlow, for every site on that zone. Turn them off if they contradict your choice in Admin → SEO. Once your custom domain works, you can also set `workers_dev = false` and `preview_urls = false` in `wrangler.toml` so the site isn't also served (duplicated) at its `workers.dev` address. NuxFlow already marks that address `noindex`.

### Media Storage

**The recommended setup is one command.** Create an R2 bucket once — `wrangler r2 bucket create nuxflow-media` — and keep the `[[r2_buckets]]` block that `wrangler.toml.example` already includes. That's it: uploads go to R2 and are served from your site's own address at `/_nuxflow/media/...`. There's no public bucket access to enable and nothing to fill in under Settings → Media. The setup wizard's last step shows **"File storage: R2 bucket connected"** when this is in place. (`wrangler dev` simulates R2 locally, so no real bucket is needed for development.)

Without that binding, and with no other provider configured below, uploads fall back to being stored as base64 inside the database, capped at 512 KB per file. That fallback only exists so a brand-new install works before storage is set up — it makes pages heavier (each image is inlined into the HTML) and fills the database. The admin dashboard, media library, Settings → Media, and Super Admin → Database all say so when it's happening.

**Already have files stored in the database?** Once storage is connected, **Settings → Media** shows how many files are still in the database, with a **Move to …** button. It copies each file to your storage, confirms the copy works, then updates every page, draft, revision, menu, setting, and avatar that used it — and only then removes the database copy. Images embedded straight into pages (for example AI-generated ones) are added to the media library as part of the move. Anything that can't be moved is left exactly as it was and listed. It's safe to run again at any time.

NuxFlow uses one provider at a time, in this order: **Cloudflare Images → R2 with a public URL → S3-compatible → Bunny.net → R2 through your site (binding only) → database fallback**. The first one that's set up wins. Adding the R2 binding never overrides an S3 or Bunny.net provider you configured on purpose. Settings → Media's status card always shows which one is in use.

### Cloudflare Images

Cloudflare Images provides optimised media hosting with automatic resizing and CDN delivery.

#### Option A — Admin UI (recommended, no redeploy required)

1. Enable **Cloudflare Images** in your Cloudflare dashboard.
2. Go to **Admin → Settings → Media** in NuxFlow.
3. Enter your **Cloudflare Account ID** (right-hand sidebar on any Cloudflare dashboard page).
4. Create an **Images API Token**: Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom Token** → add permission **Account → Cloudflare Images → Edit**. Copy the token.
5. Paste the token into the **Images API Token** field, enter the **Image Delivery URL** (found in the Cloudflare Images dashboard under **Overview**), and click **Save**.

Credentials are encrypted at rest and take effect immediately.

#### Option B — Environment variables

```bash
wrangler secret put NUXT_CLOUDFLARE_IMAGES_TOKEN
wrangler secret put NUXT_CLOUDFLARE_ACCOUNT_ID
```

Also set `NUXT_CLOUDFLARE_IMAGES_DELIVERY_URL` if using image resizing variants.

### Cloudflare R2 (native binding — recommended)

R2 is Cloudflare's own object storage: zero egress fees, no third-party account, and **no API keys or access credentials to manage at all**.

This is a *different, simpler* setup than "S3-Compatible Storage" further down this page, which reaches R2 through its optional S3-compatible API with access keys. Use the native binding unless you specifically want access-key auth.

1. Create the bucket:
   ```bash
   wrangler r2 bucket create nuxflow-media
   ```
2. Make sure `apps/nuxflow/wrangler.toml` has the `[[r2_buckets]]` block (it's enabled in `wrangler.toml.example`) and deploy:
   ```toml
   [[r2_buckets]]
   binding = "MEDIA_BUCKET"
   bucket_name = "nuxflow-media"
   ```

That's all. Files are served from your own site at `/_nuxflow/media/...`, which works on every domain of a multi-site install and survives a domain change. Feeds, sitemaps, and social-share tags automatically get the full `https://…` address.

#### Optional: serve files straight from R2

Serving through your site costs one Worker request per file (browser-cached for a year for normal uploads, so repeat visits don't re-request). If you'd rather have browsers fetch directly from R2, enable public access on the bucket — **R2 → nuxflow-media → Settings → Public access**, either the free `pub-<hash>.r2.dev` subdomain or a custom domain like `media.yourdomain.com` — and paste that URL into **Admin → Settings → Media → Cloudflare R2 → Public URL (optional)** (or set `NUXT_R2_PUBLIC_URL`).

That field is easy to confuse with two others on the same page:
- It is **not** the "Images Delivery URL" in the Cloudflare Images card — that's a different product.
- It is **not** the R2 *S3 API endpoint* (`https://<account-id>.r2.cloudflarestorage.com/...`). That endpoint needs signed requests for every read, so a browser loading an `<img>` from it is rejected.

Files uploaded before you set a public URL keep their `/_nuxflow/media/...` address, which keeps working.

### Cloudflare Stream

Cloudflare Stream provides high-performance video hosting, encoding, and adaptive-bitrate streaming. When configured, NuxFlow enables a dedicated **Videos** tab in the media library where users can upload and manage videos directly from the browser via resumable chunked uploads (TUS protocol).

#### Option A — Admin UI (recommended, no redeploy required)

Once your site is deployed, configure Stream credentials directly from the admin dashboard:

1. Log in to your site and go to **Admin → Settings → Media**.
2. Enter your **Cloudflare Account ID** — visible in the right-hand sidebar of any page in the Cloudflare dashboard.
3. Create a **Stream API Token**:
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **My Profile → API Tokens → Create Token**
   - Choose **Create Custom Token**
   - Under **Permissions**, add: **Account → Cloudflare Stream → Edit**
   - Click **Continue to summary → Create Token** and copy the token
4. Paste the token into the **Stream API Token** field and click **Save**.

Credentials saved here are encrypted at rest (AES-GCM) and take effect immediately — no redeployment required.

#### Option B — Environment variables (for automated / CI deployments)

If you prefer to manage credentials outside the admin UI, set them as Wrangler secrets from the `apps/nuxflow` directory:

```bash
wrangler secret put NUXT_CLOUDFLARE_ACCOUNT_ID
wrangler secret put NUXT_CLOUDFLARE_STREAM_TOKEN
```

*(If you have already configured `NUXT_CLOUDFLARE_ACCOUNT_ID` for Cloudflare Images, you only need to add `NUXT_CLOUDFLARE_STREAM_TOKEN`.)*

Environment variables serve as a fallback when the admin setting is empty, so you can mix approaches — set defaults via env vars and override per-site from the UI.

### S3-Compatible Storage (AWS S3, Backblaze B2, Cloudflare R2, etc.)

If you're specifically looking to use **R2**, see the [Cloudflare R2 (native binding)](#cloudflare-r2-native-binding--recommended) section above first — it needs no access keys at all and is simpler than the access-key-based setup below. Use this S3-compatible option for R2 only if you'd rather manage it the same way as AWS S3/Backblaze B2, via access keys instead of a Worker binding.

To use S3-compatible storage instead of Cloudflare Images:
1. Create a bucket and credentials in your S3 provider.
2. Add the following secrets:
```bash
wrangler secret put NUXT_S3_BUCKET
wrangler secret put NUXT_S3_ACCESS_KEY
wrangler secret put NUXT_S3_SECRET_KEY
```
Optional variables can also be set to specify a region, custom endpoint, and custom public delivery URL:
```bash
wrangler secret put NUXT_S3_REGION
wrangler secret put NUXT_S3_ENDPOINT
wrangler secret put NUXT_S3_PUBLIC_URL
```
Setting `NUXT_S3_BUCKET` automatically activates the S3 provider. You can also enter all of these per site in **Admin → Settings → Media** instead, with no redeploy.

### Bunny.net Storage

To use Bunny.net storage:
1. Create a storage zone and pull zone on Bunny.net.
2. Add the following secrets:
```bash
wrangler secret put NUXT_BUNNY_API_KEY
wrangler secret put NUXT_BUNNY_STORAGE_ZONE
wrangler secret put NUXT_BUNNY_PULL_ZONE
```
Setting `NUXT_BUNNY_API_KEY` automatically activates the Bunny.net provider. These can also be entered per site in **Admin → Settings → Media**.

### AI Providers

NuxFlow's AI-assisted writing, image generation, page/site generation, and semantic search features (see the [User Guide's AI Features section](./user-guide.md#ai-features)) work through six interchangeable providers, controlled by one `ai.provider` setting in **Admin → Settings → AI** — only one is active at a time.

#### Cloudflare Workers AI (default provider, one binding to uncomment)

AI features need **no API key and no third-party account** — just the `[ai]` binding in `wrangler.toml`. Uncomment it (it's there, commented out, in both `wrangler.toml` and `wrangler.toml.example`) before your first `wrangler deploy`, redeploy, and it's live — `ai.provider` already defaults to `workers-ai` with no other setting to touch. Cloudflare gives every account a 10,000-neurons/day free allocation before any billing kicks in, and usage beyond that bills at $0.011 per 1,000 neurons. This is one of the reasons NuxFlow requires the Workers Paid plan even for a single-site install (see Prerequisites above) — Workers AI, dynamic plugins, and password hashing all depend on it.

**It's commented out by default, unlike every other "just works" binding in this file — don't uncomment it for local `wrangler dev` use without reading this first.** Workers AI has no local simulation at all (Cloudflare's own docs: "There is no current local simulation for Workers AI"), so *declaring* the binding makes `wrangler dev` open a remote connection to the real Cloudflare edge the moment the dev server starts — which needs real authentication (`wrangler login`, run once) and otherwise fails the dev server outright with "Failed to start the remote proxy session," not a graceful fallback. This is exactly what broke this project's own E2E CI the one time the binding was left active in the template (CI has no Cloudflare credentials to log in with). If you've already run `wrangler login`, uncommenting it locally works fine and lets you exercise Workers AI-backed features against `wrangler dev` directly (you'll see a one-line warning that AI calls hit the real remote service and may incur usage charges even in local dev — expected). Otherwise, use a BYOK provider below to test AI features locally, and confirm Workers AI works after a real deploy.

#### Bring-your-own-key providers (OpenAI, Anthropic, Google Gemini, DeepSeek, Ollama)

Go to **Admin → Settings → AI**, choose a provider, and paste in an API key (for Ollama, a base URL pointing at a self-hosted instance instead — it must be reachable from the internet, e.g. through a Cloudflare Tunnel: NuxFlow runs on Cloudflare's network, so `localhost` there is never your machine). Credentials are encrypted at rest. Use this instead of Workers AI if you want a specific frontier model, or already have credits with one of these providers.

Environment variable equivalents (deployment-wide fallback, overridden by the per-site Admin UI setting): `NUXT_AI_PROVIDER`, `NUXT_OPENAI_API_KEY`, `NUXT_ANTHROPIC_API_KEY`, `NUXT_GEMINI_API_KEY`, `NUXT_DEEPSEEK_API_KEY`, `NUXT_OLLAMA_URL`, `NUXT_OLLAMA_MODEL`.

#### Cloudflare AI Gateway (optional)

Adds free response caching, request logging, and per-user spend tracking in front of whichever provider above is active — Workers AI included.

1. Cloudflare dashboard → **AI → AI Gateway → Create Gateway**. Copy the gateway ID.
2. Go to **Admin → Settings → AI → AI Gateway** in NuxFlow and enter your **Cloudflare Account ID** (right-hand sidebar on any Cloudflare dashboard page — shared with the Cloudflare Images/Stream fields above if you've already configured one of those) and the **Gateway ID**.
3. If your gateway is set to "Authenticated", also create an API token (**My Profile → API Tokens → Create Token**, with **Account → AI Gateway → Run** permission) and paste it into the **Gateway auth token** field. Leave it blank for an unauthenticated gateway.

Nothing to add to `wrangler.toml` — this is configured entirely through Settings.

#### Vectorize semantic search (optional)

Powers the "You might be looking for" fallback on the public Search page and the editor's "Related content" suggestions — a supplement to the built-in keyword search, not required for any other AI feature.

1. Create the index (dimensions must match the embedding model NuxFlow uses):
   ```bash
   wrangler vectorize create nuxflow-content --dimensions=768 --metric=cosine
   ```
2. In `apps/nuxflow/wrangler.toml`, uncomment the `[[vectorize]]` block (it's already there, commented out, with these exact values) and redeploy:
   ```toml
   [[vectorize]]
   binding = "VECTORIZE"
   index_name = "nuxflow-content"
   ```
3. That's it — no further settings to configure. Existing content is embedded automatically the next time each item is saved; there's no bulk backfill command, so editing and re-saving a published page is enough to add it to the index.

### Spam Protection (Turnstile)

Turnstile protects public forms from bots without showing a CAPTCHA challenge to real users.

1. Go to **Cloudflare Dashboard → Turnstile → Add Site** and add your domain.
2. Paste the **site key** into **Admin → Settings → Integrations → Cloudflare Turnstile** and save.
3. Add the **secret key** as a Worker secret (from `apps/nuxflow`):

```bash
wrangler secret put CLOUDFLARE_TURNSTILE_SECRET_KEY
```

Set **both** keys or neither:
- With only the site key, visitors see the Turnstile widget, but submissions are never actually verified.
- With only the secret, the widget isn't shown, so every contact-form and form submission is rejected.

### Dynamic Plugins (KV + Worker Loaders)

Dynamic plugins run as isolated Cloudflare Workers and are stored in a KV namespace. This allows plugins to be installed or updated without redeploying the site.

**Nothing extra to set up.** The KV namespace was created in [Step 3](#step-3-create-the-kv-namespace), and the `[[worker_loaders]]` binding plus a new enough `compatibility_date` (`2026-03-02` or later) are already in `wrangler.toml`. After deploying, go to **Admin → Plugins** and use **Upload plugin** to install a plugin bundle without redeploying.

For a complete walkthrough of building and publishing your own dynamic plugin — including the CLI commands, plugin structure, Canvas block registration, and troubleshooting — see the **[External Plugin Development Guide](./plugins.md)**.

### Hosting several sites

One NuxFlow installation can run many websites, each on its own domain (see [Multi-Site Hosting](./multi-site.md)). Before you add a second site, give sign-in its own domain — NuxFlow refuses to create a second site until you have.

**Why:** accounts are shared — one login works on every site. Each site's admins can also add their own code to their site (Settings → Appearance → custom code). If people typed their password on a site's own domain, that site's code could read it, and with it get into every other site that person uses. So passwords, passkeys and account settings live on one domain that never runs any site's code, the way `accounts.google.com` or `accounts.shopify.com` do.

**What people see:** clicking "Sign in" on `tenant.com` takes them to `accounts.yourplatform.com`, showing that site's name and logo. They sign in there (or are already signed in), and are sent straight back to `tenant.com`, signed in to that site only. Their password never touches `tenant.com`.

**Set it up:**

1. Pick a hostname for it, for example `accounts.yourplatform.com`. It must not be any site's domain.
2. Route it to the Worker with a **Route**, not a Custom Domain, since it shares your platform's domain. The wildcard setup in [Multi-site → Pointing a domain at the Worker](./multi-site.md#pointing-a-domain-at-the-worker) covers it along with every subdomain site. Custom Domains for several hostnames under one domain cause intermittent, unlogged `403` errors.
3. Set the variable in `apps/nuxflow/wrangler.toml` (it isn't a secret) and redeploy:

   ```toml
   [vars]
   NUXT_PUBLIC_ACCOUNTS_URL = "https://accounts.yourplatform.com"
   ```
4. If you use Google or GitHub sign-in, add the accounts domain's callback URLs to your OAuth apps — see [Social Login](#social-login-google--github) below. One app now covers every site.
5. Passkeys created before this change were tied to a site's own domain and stop working; everyone adds a new one from their account page (`https://accounts.yourplatform.com/account`).

**Local development:** modern browsers send `*.localhost` to your own machine, so no DNS is needed. Start the dev server with the variable set:

```bash
npx wrangler dev --var NUXT_PUBLIC_ACCOUNTS_URL:http://accounts.localhost:8787
```

Your site stays at `http://localhost:8787`; sign-in happens at `http://accounts.localhost:8787`.

**Credentials each site must bring itself:** payment keys (Stripe, Lemon Squeezy, Paddle) and email-provider API keys set as deployment variables are only used by the **main site** — the one created by the first install. Every other site enters its own in **Settings**, so a site can never take payments into your account or send mail through it. A site with no email provider set up sends through Cloudflare Email Sending, and only from addresses on its own domain. AI and media-storage defaults are still shared with every site.

### Social Login (Google & GitHub)

NuxFlow supports signing in — and registering — with Google and GitHub. Both providers are optional; leave the secrets unset to keep social login disabled.

#### Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**, choose **Web application**
3. Under **Authorized redirect URIs** add the domain people sign in on:
   - With a sign-in domain ([Hosting several sites](#hosting-several-sites)): `https://accounts.yourplatform.com/api/auth/callback/google` — this one entry covers every site.
   - A single site without one: `https://yourdomain.com/api/auth/callback/google`
   - Local development: `http://localhost:8787/api/auth/callback/google` (or `http://accounts.localhost:8787/...` if you run with a local sign-in domain)
4. Copy the **Client ID** and **Client Secret**, then add them as secrets:

```bash
cd apps/nuxflow
wrangler secret put NUXT_GOOGLE_CLIENT_ID
wrangler secret put NUXT_GOOGLE_CLIENT_SECRET
```



#### GitHub

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set **Authorization callback URL** to `https://accounts.yourplatform.com/api/auth/callback/github` (or `https://yourdomain.com/api/auth/callback/github` for a single site without a sign-in domain)
   - For local dev add a separate OAuth App pointing to `http://localhost:8787/api/auth/callback/github`
3. Copy the **Client ID** and generate a **Client Secret**, then add them:

```bash
wrangler secret put NUXT_GITHUB_CLIENT_ID
wrangler secret put NUXT_GITHUB_CLIENT_SECRET
```

::note
**Account linking:** if a user signs in with Google using the same email address they registered with during onboarding, NuxFlow automatically links the two accounts. No manual steps are required — see the [User Guide](./user-guide.md#social-login--account-linking) for the full flow.
::

::note
**Several sites:** accounts are shared, so Google/GitHub sign-in is one OAuth app for the whole installation. Instead of the secrets above you can also enter the credentials in **Admin → Settings → Integrations → Social Login** on the main site (stored encrypted, no redeploy needed). Other sites don't have this setting.
::

---

### Email Providers

NuxFlow supports several providers for transactional mail (password resets, notifications, contact form replies).

#### Cloudflare (recommended)

Uses Cloudflare's native Email Sending Workers binding — no third-party account or API key needed. The `[[send_email]]` binding (`name = "EMAIL"`) already ships in `apps/nuxflow/wrangler.toml` — it's a one-time, deployment-wide binding shared by every site behind this Worker (one Worker, one binding, regardless of how many sites/domains it serves), so there's nothing to add here yourself.

The one thing that is per-domain is registering your sending domain with Cloudflare's Email Sending product:

```bash
wrangler email sending enable yourdomain.com
```

This adds the SPF/DKIM DNS records receiving mail servers (Gmail, Outlook, etc.) check before trusting a message. Until the domain is onboarded, Cloudflare only delivers to *verified destination addresses* in your own Cloudflare account — so password resets, invites, and notifications to anyone else won't arrive. The domain must be a zone in the same Cloudflare account as this Worker. In a multi-site install, run it once per site's custom sending domain, not once per installation. Cloudflare treats every **subdomain** as a separate sending domain too, so a site at `site-a.yourplatform.com` needs `wrangler email sending enable site-a.yourplatform.com` of its own. A zone allows 30 sending/routing domains in total, apex included. If an invite or reset email can't be delivered, NuxFlow says so on the Users page (and **Super Admin → Email** lists the failure) rather than reporting the invite as sent.

Cloudflare Email Service is for **transactional** mail only (its terms exclude marketing and bulk sends), and its sending quota is per Cloudflare account — shared by every site on the deployment. Admin → Super Admin → Email shows per-site usage from NuxFlow's own send log. See [Email](email.md) for receiving mail (inboxes, email-to-draft).

Select **Cloudflare** as the email provider in **Admin → Settings → Email** — no redeploy needed for that part, since the binding is already present.

#### Third-party API key providers

Add the relevant secret for your chosen provider, then select it in **Admin → Settings → Email**:

| Provider | Secret |
|---|---|
| Resend | `NUXT_RESEND_API_KEY` |
| Brevo | `NUXT_BREVO_API_KEY` |
| ZeptoMail | `NUXT_ZEPTO_API_KEY` |

If no provider is configured, NuxFlow logs emails to the console in development.

---

## 5. After-installation checklist

NuxFlow is built to keep working when something isn't set up yet, so a missing piece often shows up as a *slow* or *quietly broken* site rather than an error message. This checklist covers the settings that matter for **every** installation. It leaves out features only some sites need, such as payments, video, or social login.

Each item says what goes wrong if you skip it and how to check it's done.

> [!TIP]
> **You don't have to check these by hand.** The admin dashboard shows a **Finish setting up your site** card that checks each item live and ticks it off once it's done. Each entry has a button that takes you to where it's fixed, plus a **How to** link back to this page. Essential items can't be skipped. Recommended ones can, and the card can be hidden once every essential item is done. It comes back by itself if something essential breaks later, for example if email starts failing.

### Do not skip

#### ☐ 1. Connect file storage (R2)

- **If you skip it:** every uploaded image is stored inside the database. Each file is limited to 512 KB, and images are inlined into your pages, which makes every page slower to load and fills up the database.
- **Do this:** run `wrangler r2 bucket create nuxflow-media` once from `apps/nuxflow`, keep the `[[r2_buckets]]` block in `wrangler.toml`, and deploy. There's nothing to type into the admin. See [Media Storage](#media-storage).
- **Check:** **Admin → Settings → Media** says *"New uploads go to Cloudflare R2"*. If it says *"No file storage connected yet"*, it isn't working.
- **Already uploaded images before this?** The same page shows how many files are still in the database, with a **Move to Cloudflare R2** button. It's safe to run more than once.

#### ☐ 2. Turn on email sending

- **If you skip it:** NuxFlow doesn't send email at all. It only writes emails to the server log, and nothing warns you. Password-reset links, user invitations, email verification, and security alerts never arrive, which can lock you out of your own site.
- **Do this:** in **Admin → Settings → Email**, choose **Cloudflare**. Then run `wrangler email sending enable yourdomain.com` once for your domain. See [Email Providers](#email-providers). Resend, Brevo, and ZeptoMail also work.
- **Check:** use **Send a test email** on that page, sent to an address that *isn't* on your Cloudflare account (a personal Gmail address works). Until the domain is enabled, Cloudflare only delivers to addresses verified on your own account, so a test to yourself can succeed even though other people won't receive anything.

#### ☐ 3. Use your own domain, and only that domain

- **If you skip it:** your site stays on its `something.workers.dev` address. If you add a domain but leave that address on, search engines can find two copies of every page.
- **Do this:**
  1. Add your domain ([Step 8](#step-8-add-a-custom-domain)).
  2. Once the domain works, sign in to the admin **on the new domain**.
  3. Then set `workers_dev = false` and `preview_urls = false` in `wrangler.toml` and deploy again.
- **Check:** your pages open on your domain, and the `workers.dev` address no longer serves the site.
- **If you'd rather keep the `workers.dev` address:** NuxFlow already marks it `noindex` so search engines ignore it. **Admin → SEO → Indexing** can also redirect it to your domain.

#### ☐ Running more than one site? Give sign-in its own domain

Only applies once you host a second site. Set `NUXT_PUBLIC_ACCOUNTS_URL` so passwords and passkeys are only ever entered on a domain no site's code runs on — see [Hosting several sites](#hosting-several-sites). NuxFlow won't create a second site until this is done.

#### ☐ 4. Keep your auth secret safe, and never change it

- **Why it matters:** `NUXT_BETTER_AUTH_SECRET` signs everyone's login sessions and encrypts the API keys and passwords you save in Settings (payment keys, email API keys, and so on). Changing it later signs everyone out and makes every saved key unreadable, so you'd have to re-enter them all.
- **Do this:** make sure it's a long random value (the `create-nuxflow-app` scaffolder generates one for you) set with `wrangler secret put NUXT_BETTER_AUTH_SECRET`. Keep a copy in your password manager.
- **Check:** `wrangler secret list` (from `apps/nuxflow`) shows `NUXT_BETTER_AUTH_SECRET`.

#### ☐ 5. Set up the basics for search engines and AI

- **If you skip it:** your homepage and archive pages have no description, shared links show no picture, and search engines have to find the site on their own.
- **Do this:**
  - In **Admin → SEO → Global defaults**, add a default description and a default share image. **AI suggest** can write the description for you.
  - In **Admin → SEO → AI & crawlers**, choose how AI assistants may use your content. The recommended choice lets them cite you but not train on you.
  - In the Cloudflare dashboard, check that **AI Crawl Control → Block AI bots** and **Managed robots.txt** don't contradict that choice. Those settings apply before NuxFlow sees the request.
  - Add your site to [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters). Paste their verification codes into **Admin → SEO → Social & verification**, then submit `sitemap.xml` in both.
- **Check:** **Admin → SEO → Audit** shows no red items in the site-level list at the top.

### Strongly recommended

#### ☐ 6. Turn on AI features (Workers AI)

- **If you skip it:** the AI buttons (alt text, SEO suggestions, writing help, translation, page generation) show an error, and the automatic spam filter for comments and forms is quietly off.
- **Do this:** uncomment the `[ai]` block in `wrangler.toml` and deploy. There's no API key, and there's a daily free allowance. See [AI Providers](#ai-providers). Alternatively, add an OpenAI, Anthropic, or other key in **Admin → Settings → AI**.
- **Check:** click **AI suggest** in **Admin → SEO → Global defaults**. It should fill in a title and description.

#### ☐ 7. Protect your forms from bots (Turnstile)

This applies if your site has a contact form or other forms.

- **If you skip it:** bots can submit your forms freely, and the AI spam filter is the only thing catching them.
- **Do this:** follow [Spam Protection (Turnstile)](#spam-protection-turnstile). Set **both** keys; one on its own doesn't work.
- **Check:** your contact form shows the small Turnstile check above the submit button, and a test message still arrives.

#### ☐ 8. Secure your admin account

- **Do this:** add a passkey (Face ID, Touch ID, Windows Hello, or a security key) under **Settings → Security → Passkeys & Passwordless Login** — or, with a sign-in domain ([Hosting several sites](#hosting-several-sites)), on your account page there. It's faster than a password and can't be phished. Also make sure your account's email address is one you actually receive mail at, since password resets go there.

#### ☐ 9. Know where your backups are

- **Already on:** Cloudflare keeps a restorable history of your database automatically (D1 Time Travel, 30 days on the Workers Paid plan). An operator can roll back to any minute in that window with `wrangler d1 time-travel restore`.
- **Do this too:** download a backup from **Admin → Import → Backup** once your site has content, and again before big changes. It includes your content, settings, users' roles, and media, and it can be restored onto a fresh installation.

#### ☐ 10. Turn on IndexNow

- **Do this:** switch on **Admin → SEO → Indexing → IndexNow**, then click **Submit all URLs now** once. After that, Bing and other participating search engines hear about new and changed pages within minutes instead of days. There's no account to create.

