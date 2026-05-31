# Installation Guide

NuxFlow runs on Cloudflare Workers with **Cloudflare D1** as the default database. D1 is SQLite at the edge — no separate account, no credentials to manage, everything lives inside your Cloudflare account. Turso is supported as an optional alternative for users who prefer it.

## Prerequisites

Install the following tools before you begin:

- **Node.js** 20 or higher
- **pnpm** 9 or higher — `npm install -g pnpm`
- **Wrangler** v4 (Cloudflare CLI) — `pnpm add -g wrangler`

---

## 1. Local Development

### Clone the Repository

```bash
git clone https://github.com/nuxflow/nuxflow.git
cd nuxflow
pnpm install
```

### Copy Wrangler Configuration

NuxFlow uses Wrangler for local development and edge deployment. Copy the example wrangler config file inside the app folder:

```bash
cp apps/nuxflow/wrangler.toml.example apps/nuxflow/wrangler.toml
```

### Set Up a Local Database

There are three options. **Option A is recommended** — it uses the same D1 database as production, so there are no surprises when you deploy.

**Option A — Cloudflare D1 via `wrangler dev` (recommended):**

This mirrors production exactly. `wrangler dev` provisions a local D1 database automatically — no `.env` file is needed for the database connection.

Start the dev server from the `apps/nuxflow` directory:

```bash
cd apps/nuxflow
wrangler dev
```

Database migrations run automatically on the first request. Visit `http://localhost:8787/setup` to complete the onboarding wizard. Once setup is complete, you can access your admin dashboard at `http://localhost:8787/admin`.

**Option B — Local SQLite file (no Cloudflare account required):**

NuxFlow can use a plain SQLite file for local development via its libSQL adapter — no Turso account is needed.

Copy the example env file and set the database path:

```bash
cp apps/nuxflow/.env.example apps/nuxflow/.env
```

```
NUXT_TURSO_URL=file:local.db
NUXT_TURSO_AUTH_TOKEN=
NUXT_BETTER_AUTH_SECRET=your-32-char-secret-here
NUXT_PUBLIC_SITE_URL=http://localhost:3000
```

Start the dev server:

```bash
pnpm dev
```

Database migrations run automatically on the first request. Visit `http://localhost:3000/setup` to complete the onboarding wizard. Once setup is complete, you can access your admin dashboard at `http://localhost:3000/admin`.

**Option C — Turso remote database:**

Use this if you prefer a managed cloud database for development, or if you intend to deploy to a non-Cloudflare host.

```bash
turso db create nuxflow-dev
turso db show nuxflow-dev --url
turso db tokens create nuxflow-dev
```

Copy the example env file and fill in your Turso credentials:

```bash
cp apps/nuxflow/.env.example apps/nuxflow/.env
```

```
NUXT_TURSO_URL=libsql://your-db.turso.io
NUXT_TURSO_AUTH_TOKEN=your-token
NUXT_BETTER_AUTH_SECRET=your-32-char-secret-here
NUXT_PUBLIC_SITE_URL=http://localhost:3000
```

Start the dev server:

```bash
pnpm dev
```

Database migrations run automatically on the first request. Visit `http://localhost:3000/setup` to complete the onboarding wizard. Once setup is complete, you can access your admin dashboard at `http://localhost:3000/admin`.

::note
**How migrations work:** NuxFlow bundles all database migration files into the deployed Worker. On the very first request after a fresh install or an upgrade, any migrations that have not yet been applied are executed automatically. A `_nuxflow_migrations` table in your database tracks which files have already run, so no migration is ever applied twice. You never need to run a migration command manually.
::

---

## 2. Cloudflare Deployment

NuxFlow deploys as a **Cloudflare Worker** using the `cloudflare-module` Nitro preset. The `wrangler.toml` in `apps/nuxflow` is pre-configured with D1 as the default database.

> [!IMPORTANT]
> **Local Build Requirements:**
> Even when deploying straight to Cloudflare, the build compilation runs on your local machine before being uploaded. Therefore, you **must** do the following before running `pnpm build`:
> 1. **Install Dependencies:** If you skipped the local development steps, ensure you have run `pnpm install` in the repository root directory.
> 2. **Local `.env` File:** You must copy the example configuration:
>    ```bash
>    cp apps/nuxflow/.env.example apps/nuxflow/.env
>    ```
>    *(The build compiler validates environment schemas at compile time and will crash if `NUXT_BETTER_AUTH_SECRET` is missing. You can leave the placeholder values as is.)*

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

### Step 4: Build and Deploy

Return to the repo root, build, then deploy:

```bash
cd ../..
pnpm build
pnpm --filter @nuxflow/app run deploy
```

Database migrations run automatically on the first request after deployment. There is nothing else to run.

### Step 5: Add Production Secrets

With the worker now deployed, add your runtime secrets. Wrangler will prompt you to type or paste the value — it is never passed as a command-line argument:

```bash
cd apps/nuxflow
wrangler secret put NUXT_BETTER_AUTH_SECRET
wrangler secret put NUXT_PUBLIC_SITE_URL
```

Secrets on Cloudflare Workers take effect immediately — no redeploy is needed after adding them.

You can also manage secrets in the Cloudflare dashboard under **Workers & Pages → nuxflow → Settings → Variables and Secrets**.

::note
D1 does not require any secrets. The database connection is handled automatically through the `DB` binding declared in `wrangler.toml`.
::

### Step 5: Add a Custom Domain

By default Cloudflare assigns a `*.workers.dev` subdomain. To use your own domain:

1. Open **Workers & Pages → nuxflow → Settings → Domains & Routes**
2. Click **Add** → **Custom Domain**
3. Enter your domain or subdomain (e.g. `cms.yourdomain.com`)
4. Cloudflare creates the DNS record and provisions a TLS certificate automatically

Your domain must be on Cloudflare's nameservers for this to work. If it is not, use a **Route** instead and point the DNS record manually.

### Step 6: Verify Cron Triggers

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

Rather than connecting Cloudflare directly to the `nuxflow/nuxflow` repository, we strongly recommend creating your own fork on GitHub first.

Deploying from a fork means you control when upstream updates are pulled in, so a new NuxFlow release never lands on your live site without your review. It also gives you a place to add site-specific customisations and to run a staging environment — for example, a second Cloudflare Worker connected to the same fork's `staging` branch — before changes reach production.

To fork:

1. Go to [github.com/nuxflow/nuxflow](https://github.com/nuxflow/nuxflow) and click **Fork**
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

## 4. Using Turso Instead of D1

Turso is a managed libSQL database service that works as an alternative to D1. Use it if you prefer a standalone database service, or if you want to run NuxFlow outside of Cloudflare Workers.

**Step 1 — Install the Turso CLI and create a database:**

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso db create nuxflow
turso db show nuxflow --url
turso db tokens create nuxflow
```

**Step 2 — Remove the D1 binding from `wrangler.toml`:**

Comment out or delete the `[[d1_databases]]` block:

```toml
# [[d1_databases]]
# binding = "DB"
# database_name = "nuxflow"
# database_id = "..."
```

**Step 3 — Add Turso secrets:**

```bash
cd apps/nuxflow
wrangler secret put NUXT_TURSO_URL
wrangler secret put NUXT_TURSO_AUTH_TOKEN
```

**Step 4 — Add the same secrets as build-time environment variables** in **Workers & Pages → nuxflow → Settings → Build → Environment variables**:

| Variable | Value |
|---|---|
| `NUXT_TURSO_URL` | Your Turso database URL |
| `NUXT_TURSO_AUTH_TOKEN` | Your Turso auth token |
| `NUXT_BETTER_AUTH_SECRET` | Your session-signing secret |
| `NUXT_PUBLIC_SITE_URL` | Your production site URL |

NuxFlow automatically detects that no D1 binding is present and falls back to Turso. Database migrations run automatically on the first request after deployment.

---

## 5. Additional Configuration

All `wrangler secret put` commands in this section must be run from the `apps/nuxflow` directory.

### Cloudflare Images

Cloudflare Images provides optimised media hosting with automatic resizing and CDN delivery.

1. Enable **Cloudflare Images** in your dashboard
2. Create an API token with `Image:Edit` permissions
3. Add the following secrets:

```bash
wrangler secret put NUXT_CLOUDFLARE_IMAGES_TOKEN
wrangler secret put NUXT_CLOUDFLARE_ACCOUNT_ID
```

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

```bash
cd ../..
pnpm build
pnpm --filter @nuxflow/app run deploy
```

The `[[worker_loaders]]` binding is enabled automatically once you deploy with the updated `wrangler.toml`.

**Step 3 — Upload plugins:**

After deploying, go to **Admin → Plugins** and use the **Upload plugin** button to install a dynamic plugin bundle without redeploying.

::note
Dynamic plugins are a Cloudflare-only feature. They are not available in local development with `pnpm dev`. Use `wrangler dev` to test them locally with real KV and Worker Loader bindings.
::

For a complete walkthrough of building and publishing your own dynamic plugin — including the CLI commands, plugin structure, Canvas block registration, and troubleshooting — see the **[External Plugin Development Guide](./plugins.md)**.

### Email Providers

NuxFlow supports several email providers for transactional mail. Add the relevant secret for your chosen provider:

| Provider | Secret |
|---|---|
| Resend | `NUXT_RESEND_API_KEY` |
| Brevo | `NUXT_BREVO_API_KEY` |
| ZeptoMail | `NUXT_ZEPTO_API_KEY` |
| MailChannels SMTP | `NUXT_SMTP_HOST`, `NUXT_SMTP_PORT`, `NUXT_SMTP_USER`, `NUXT_SMTP_PASS` |
