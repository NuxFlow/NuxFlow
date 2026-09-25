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


After the scaffolder finishes, follow the prompts to create your D1 database and deploy. The sections below cover every step in detail if you need to configure things manually or want to contribute to NuxFlow itself.

---

## Prerequisites

Install the following tools before you begin:

- **Node.js** 20 or higher
- **pnpm** 9 or higher — `npm install -g pnpm`
- **Wrangler** v4 (Cloudflare CLI) — `pnpm add -g wrangler`
- A **Cloudflare Workers Paid plan** ($5/month minimum) — NuxFlow requires this to run at all, not just for optional features like dynamic plugins. The Free plan's CPU time limit is too tight for a full Nuxt SSR CMS.

---

## 1. Local Development

### Clone the Repository

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

### Set Up a Local Database

**Cloudflare D1 via `wrangler dev`:**

This mirrors production exactly. `wrangler dev` provisions a local D1 database automatically — no `.env` file is needed for the database connection.

Start the dev server from the `apps/nuxflow` directory:

```bash
cd apps/nuxflow
wrangler dev
```

`pnpm dev` from the repository root does the same thing — `wrangler dev` is the only supported local development workflow; there is no separate `nuxt dev` path.

The first run will compile the Nuxt app before starting (this takes about a minute). Subsequent starts reuse the compiled output and are much faster. To pick up source code changes, stop the server and run `wrangler dev` again — or rebuild manually with `pnpm build` from the repo root and then restart.

Database migrations run automatically on the first request. Visit `http://localhost:8787/setup` to complete the onboarding wizard. Once setup is complete, you can access your admin dashboard at `http://localhost:8787/admin`.

::note
**How migrations work:** NuxFlow bundles all database migration files into the deployed Worker. On the very first request after a fresh install or an upgrade, any migrations that have not yet been applied are executed automatically. A `_nuxflow_migrations` table in your database tracks which files have already run, so no migration is ever applied twice. You never need to run a migration command manually.
::

---

## 2. Cloudflare Deployment

NuxFlow deploys as a **Cloudflare Worker** using the `cloudflare-module` Nitro preset. The `wrangler.toml` in `apps/nuxflow` is pre-configured with D1 as the default database.

> [!IMPORTANT]
> **Before deploying, make sure you have:**
> 1. **Installed dependencies:** If you skipped the local development steps, run `pnpm install` from the repository root first.
> 2. **A local `.env` file:** Copy the example configuration:
>    ```bash
>    cp apps/nuxflow/.env.example apps/nuxflow/.env
>    ```
>    *(The build compiler validates environment schemas at compile time and will crash if `NUXT_BETTER_AUTH_SECRET` is missing. You can leave the placeholder values as is.)*
> 3. **A Workers Paid plan** ($5/month minimum) on the Cloudflare account you're deploying to — see [Prerequisites](#prerequisites). Argon2id password hashing (~150-175ms per hash) and normal Nuxt SSR rendering both need more CPU time than the Free plan's 10ms budget allows.

### Step 1: Log In to Cloudflare

```bash
wrangler login
```

This opens a browser window to authenticate your Cloudflare account.

### Step 2: Create the D1 Database

Run the following from the `apps/nuxflow` directory:

```bash
cd apps/nuxflow
wrangler d1 create nuxflow
```

Wrangler prints a `database_id`. Open `apps/nuxflow/wrangler.toml` and paste it into the `[[d1_databases]]` block:

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

### Step 4: Build and Deploy the Main App

From the `apps/nuxflow` directory, run:

```bash
pnpm run deploy
```

This builds the app and uploads it to Cloudflare in one step — you do not need to run a separate build command. The `[build]` section in `wrangler.toml` instructs Wrangler to compile the Nuxt app before uploading.

Database migrations run automatically on the first request after deployment. There is nothing else to run.

### Step 5: Add Production Secrets

With the worker now deployed, add your runtime secrets. Wrangler will prompt you to type or paste the value — it is never passed as a command-line argument:

```bash
cd apps/nuxflow
wrangler secret put NUXT_BETTER_AUTH_SECRET
```

Secrets on Cloudflare Workers take effect immediately — no redeploy is needed after adding them.

You can also manage secrets in the Cloudflare dashboard under **Workers & Pages → nuxflow → Settings → Variables and Secrets**.

::note
`NUXT_PUBLIC_SITE_URL` is **not** a secret — it is a plain variable declared in the `[vars]` section of `apps/nuxflow/wrangler.toml`. Set it there before deploying; do not use `wrangler secret put` for this value.
::

::note
D1 does not require any secrets. The database connection is handled automatically through the `DB` binding declared in `wrangler.toml`.
::

### Step 6: Add a Custom Domain

By default Cloudflare assigns a `*.workers.dev` subdomain. To use your own domain:

1. Open **Workers & Pages → nuxflow → Settings → Domains & Routes**
2. Click **Add** → **Custom Domain**
3. Enter your domain or subdomain (e.g. `cms.yourdomain.com`)
4. Cloudflare creates the DNS record and provisions a TLS certificate automatically

Your domain must be on Cloudflare's nameservers for this to work. If it is not, use a **Route** instead and point the DNS record manually.

### Step 7: Verify Cron Triggers

NuxFlow uses a scheduled Worker to handle timed content publishing. The trigger is defined in `wrangler.toml`:

```toml
[triggers]
crons = ["* * * * *"]
```

After deploying, confirm the trigger is active in **Workers & Pages → nuxflow → Settings → Triggers → Cron Triggers**. You should see one entry running every minute.

To test the scheduled handler locally (run from `apps/nuxflow`):

```bash
wrangler dev --test-scheduled
```

Then call `http://localhost:8787/__scheduled` to trigger it manually.

---

## 3. Automated Deploys via GitHub

Connecting NuxFlow to GitHub lets Cloudflare rebuild and redeploy your site automatically every time you push. This section explains the recommended setup and the exact settings to enter in the Cloudflare dashboard.

### Fork the Repository First

Rather than connecting Cloudflare directly to the `NuxFlow/NuxFlow` repository, we strongly recommend creating your own fork on GitHub first.

Deploying from a fork means you control when upstream updates are pulled in, so a new NuxFlow release never lands on your live site without your review. It also gives you a place to add site-specific customisations and to run a staging environment — for example, a second Cloudflare Worker connected to the same fork's `staging` branch — before changes reach production.

To fork:

1. Go to [github.com/NuxFlow/NuxFlow](https://github.com/NuxFlow/NuxFlow) and click **Fork**
2. Clone your fork and use it as the basis for your deployment

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

### Build-Time Environment Variables

This is a separate step from the runtime secrets you set with `wrangler secret put`. Secrets added via Wrangler are encrypted and available to your running Worker, but they are **not** injected into the build container. You must add any variables that Nuxt reads at build time as build-time environment variables.

In **Workers & Pages → nuxflow → Settings → Build → Environment variables**, add:

| Variable | Value |
|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Your session-signing secret |
| `NUXT_PUBLIC_SITE_URL` | Your production site URL |

::note
D1 credentials are not required here. The D1 binding in `wrangler.toml` is resolved at deploy time by Wrangler — no environment variable is needed for the build or at runtime.
::

Add any other variables your site uses (Cloudflare Images, Turnstile, email providers) here too. If a variable is required during the Nuxt build and is missing, the build will fail before any code is deployed.

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
| `/llms.txt` | Machine-readable Markdown index of your site for ChatGPT, Claude, Perplexity, etc. |
| `/atom.xml` | Atom 1.0 feed (alongside RSS 2.0 at `/feed.xml`) with author and image metadata |
| `/sitemap.xml` | Includes `image:image` namespace tags for pages with OG images |
| JSON-LD | `Article`, `BreadcrumbList`, `Organization`, and `WebSite` schemas auto-injected per page |

**To control AI crawler access**, go to **Admin → SEO → AI Crawlers** after deploying. The "allow/block all AI crawlers" toggle adds or removes explicit `robots.txt` rules for GPTBot, ClaudeBot, PerplexityBot, and seven others without requiring a redeploy.

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
wrangler secret put S3_BUCKET
wrangler secret put S3_ACCESS_KEY
wrangler secret put S3_SECRET_KEY
```
Optional variables can also be set to specify a region, custom endpoint, and custom public delivery URL:
```bash
wrangler secret put S3_REGION
wrangler secret put S3_ENDPOINT
wrangler secret put S3_PUBLIC_URL
```
Setting the `S3_BUCKET` secret automatically activates the S3 provider.

### Bunny.net Storage

To use Bunny.net storage:
1. Create a storage zone and pull zone on Bunny.net.
2. Add the following secrets:
```bash
wrangler secret put BUNNY_API_KEY
wrangler secret put BUNNY_STORAGE_ZONE
wrangler secret put BUNNY_PULL_ZONE
```
Setting the `BUNNY_API_KEY` secret automatically activates the Bunny.net provider.

### AI Providers

NuxFlow's AI-assisted writing, image generation, page/site generation, and semantic search features (see the [User Guide's AI Features section](./user-guide.md#ai-features)) work through six interchangeable providers, controlled by one `ai.provider` setting in **Admin → Settings → AI** — only one is active at a time.

#### Cloudflare Workers AI (default provider, one binding to uncomment)

AI features need **no API key and no third-party account** — just the `[ai]` binding in `wrangler.toml`. Uncomment it (it's there, commented out, in both `wrangler.toml` and `wrangler.toml.example`) before your first `wrangler deploy`, redeploy, and it's live — `ai.provider` already defaults to `workers-ai` with no other setting to touch. Cloudflare gives every account a 10,000-neurons/day free allocation before any billing kicks in, and usage beyond that bills at $0.011 per 1,000 neurons. This is one of the reasons NuxFlow requires the Workers Paid plan even for a single-site install (see Prerequisites above) — Workers AI, dynamic plugins, and password hashing all depend on it.

**It's commented out by default, unlike every other "just works" binding in this file — don't uncomment it for local `wrangler dev` use without reading this first.** Workers AI has no local simulation at all (Cloudflare's own docs: "There is no current local simulation for Workers AI"), so *declaring* the binding makes `wrangler dev` open a remote connection to the real Cloudflare edge the moment the dev server starts — which needs real authentication (`wrangler login`, run once) and otherwise fails the dev server outright with "Failed to start the remote proxy session," not a graceful fallback. This is exactly what broke this project's own E2E CI the one time the binding was left active in the template (CI has no Cloudflare credentials to log in with). If you've already run `wrangler login`, uncommenting it locally works fine and lets you exercise Workers AI-backed features against `wrangler dev` directly (you'll see a one-line warning that AI calls hit the real remote service and may incur usage charges even in local dev — expected). Otherwise, use a BYOK provider below to test AI features locally, and confirm Workers AI works after a real deploy.

#### Bring-your-own-key providers (OpenAI, Anthropic, Google Gemini, DeepSeek, Ollama)

Go to **Admin → Settings → AI**, choose a provider, and paste in an API key (for Ollama, a base URL pointing at a self-hosted instance instead). Credentials are encrypted at rest. Use this instead of Workers AI if you want a specific frontier model, or already have credits with one of these providers.

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

1. Go to **Cloudflare Dashboard → Turnstile → Add Site**
2. Copy the site key and secret key
3. Add the secrets:

```bash
wrangler secret put NUXT_PUBLIC_TURNSTILE_SITE_KEY
wrangler secret put NUXT_TURNSTILE_SECRET_KEY
```

### Dynamic Plugins (KV + Worker Loaders)

Dynamic plugins run as isolated Cloudflare Workers and are stored in a KV namespace. This allows plugins to be installed or updated without redeploying the site.

**Requirements:** `compatibility_date` must be `2026-03-02` or later (already set in `wrangler.toml`).

**Step 1 — Create the KV namespaces:**

Run both commands from the `apps/nuxflow` directory. The first creates the production namespace, the second creates a separate preview namespace used by `wrangler dev`:

```bash
wrangler kv namespace create PLUGIN_KV
wrangler kv namespace create PLUGIN_KV --preview
```

Each command prints a snippet like this — copy the `id` value from each:

```
✨ Success!
[[kv_namespaces]]
binding = "PLUGIN_KV"
id = "d6a28a91e4344aabbd952cb68cff4c3d"
```

Open `apps/nuxflow/wrangler.toml` and paste both IDs into the `[[kv_namespaces]]` block:

```toml
[[kv_namespaces]]
binding = "PLUGIN_KV"
id = "YOUR_ID_FROM_FIRST_COMMAND"
preview_id = "YOUR_ID_FROM_SECOND_COMMAND"
```

**Step 2 — Redeploy:**

From the `apps/nuxflow` directory:

```bash
pnpm run deploy
```

The `[[worker_loaders]]` binding is enabled automatically once you deploy with the updated `wrangler.toml`.

**Step 3 — Upload plugins:**

After deploying, go to **Admin → Plugins** and use the **Upload plugin** button to install a dynamic plugin bundle without redeploying.

::note
Dynamic plugins are a Cloudflare-only feature. They are not available in local development with `pnpm dev`. Use `wrangler dev` to test them locally with real KV and Worker Loader bindings.
::

For a complete walkthrough of building and publishing your own dynamic plugin — including the CLI commands, plugin structure, Canvas block registration, and troubleshooting — see the **[External Plugin Development Guide](./plugins.md)**.

### Social Login (Google & GitHub)

NuxFlow supports signing in — and registering — with Google and GitHub. Both providers are optional; leave the secrets unset to keep social login disabled.

#### Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**, choose **Web application**
3. Under **Authorized redirect URIs** add one entry for each domain that will use Google sign-in:
   - `http://localhost:8787/api/auth/callback/google` (local development — `pnpm dev` and `wrangler dev` are the same thing, see [Local Development](#1-local-development))
   - `https://yourdomain.com/api/auth/callback/google` (production primary domain)
   - `https://anotherdomain.com/api/auth/callback/google` (any additional custom domain)
4. Copy the **Client ID** and **Client Secret**, then add them as secrets:

```bash
cd apps/nuxflow
wrangler secret put NUXT_GOOGLE_CLIENT_ID
wrangler secret put NUXT_GOOGLE_CLIENT_SECRET
```

::note
**Multi-domain deployments:** you do **not** need a separate Google Cloud project or OAuth client per domain. A single OAuth 2.0 client supports multiple redirect URIs — just add `/api/auth/callback/google` for every custom domain in the same client's **Authorized redirect URIs** list. NuxFlow automatically uses the correct callback URL for each domain using the incoming request's hostname.
::

#### GitHub

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set **Authorization callback URL** to `https://yourdomain.com/api/auth/callback/github`
   - For local dev add a separate OAuth App pointing to `http://localhost:8787/api/auth/callback/github`
3. Copy the **Client ID** and generate a **Client Secret**, then add them:

```bash
wrangler secret put NUXT_GITHUB_CLIENT_ID
wrangler secret put NUXT_GITHUB_CLIENT_SECRET
```

If you use automated deploys, add these four variables as build-time environment variables in **Workers & Pages → nuxflow → Settings → Build → Environment variables** as well — the same way you add `NUXT_BETTER_AUTH_SECRET`.

::note
**Account linking:** if a user signs in with Google using the same email address they registered with during onboarding, NuxFlow automatically links the two accounts. No manual steps are required — see the [User Guide](./user-guide.md#social-login--account-linking) for the full flow.
::

::note
**Multi-site deployments:** the `wrangler secret` values above are a single deployment-wide default — every site falls back to them unless it configures its own. Since GitHub OAuth Apps only support one callback URL each, a secondary site that needs GitHub login needs its own OAuth App and its own credentials, set per-site via **Admin → Settings → Integrations → Social Login** on that site's domain rather than as another `wrangler secret`. Google doesn't have this limitation (one client, many redirect URIs), so the shared default is usually enough there. See [Multi-Site Hosting → Social login on custom domains](./multi-site.md#social-login-on-custom-domains) for the full picture.
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

This adds the SPF/DKIM DNS records receiving mail servers (Gmail, Outlook, etc.) check before trusting a message. Until the domain is onboarded, Cloudflare only delivers to *verified destination addresses* in your own Cloudflare account — so password resets, invites, and notifications to anyone else won't arrive. The domain must be a zone in the same Cloudflare account as this Worker. In a multi-site install, run it once per site's custom sending domain, not once per installation.

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
