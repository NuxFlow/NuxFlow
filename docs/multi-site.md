# Multi-Site Hosting

A single NuxFlow deployment can host any number of independent websites, each on its own domain. All sites share one Cloudflare Worker and one D1 database, but their content, users, settings, themes, and plugins are completely isolated from one another.

## How routing works

Every incoming request carries a `Host` header. The multi-site middleware reads that header and looks up a matching record in the `sites` table. Everything downstream — content queries, authentication, permissions, and plugins — is scoped to the resolved site.

If no site matches the incoming domain, NuxFlow falls back to a single-site rule: if there is exactly one site in the database, all requests are served by that site regardless of the domain. This allows you to access your admin panel after migrating to a new domain before you have updated the record.

The stored domain only self-heals to match the live request on `/admin` traffic — not on public pages or crawler requests (`/robots.txt`, `/sitemap.xml`, etc.). This matters if you ever point a second, not-yet-onboarded domain at the same Worker: without this restriction, any stray request to that unclaimed domain (even a bot fetching `/robots.txt`) would silently reassign your real site's domain away from its actual production domain. Visiting `/admin` on the new domain while logged in is what actually confirms the migration.

::note
The single-site fallback only triggers when there is **one** site in the database. Once you add a second site, every domain must resolve to an explicit record.
::

### The "Magic Mirror" Architecture (Single Worker)

A common point of confusion is whether you need to deploy separate Cloudflare Workers for each custom domain. **You do not.** 

A single NuxFlow deployment runs on exactly **one Cloudflare Worker** and connects to **one database**. The Worker acts like a "magic mirror":
1. When a visitor requests `xyz.com`, the request hits your single Worker.
2. The Worker inspects the HTTP `Host` header (`xyz.com`).
3. It queries the database to see which site record has `domain = 'xyz.com'`.
4. It isolates and scopes all database queries specifically to that site's ID.

This allows you to host an unlimited number of custom domains with absolute data separation under a single, low-cost serverless Worker deployment.

---

## Before your second site: a sign-in domain

Accounts are shared across every site — one login, one password. Because each site's admins can add their own code to their own pages, nobody types their password on a site's domain. Sign-in, passkeys and account settings live on a separate **sign-in domain** (for example `accounts.yourplatform.com`) that never runs any site's code; each site receives a login that works on that site only. NuxFlow won't create a second site until this is set up — see [Installation → Hosting several sites](./installation.md#hosting-several-sites) for the three steps.

---

## Adding a new site

New sites are created from within the super admin panel of any existing NuxFlow instance. You must be logged in with a `super_admin` role.

### Step 1 — Open the Sites panel

In the admin sidebar, scroll to the **Super Admin** section at the bottom and click **Sites**. This page lists every site in the deployment and their current status. The section is only visible to users with the `super_admin` role.

### Step 2 — Create the site

Click **New site** and fill in the following fields:

| Field | Description |
|---|---|
| **Site name** | A human-readable label shown in the admin panel |
| **Domain** | The hostname the site will respond to, e.g. `example.com`. A pasted URL is fine — it's stored as the bare lower-case hostname. Each domain can belong to one site only, and only a super admin can change it later. |
| **Default locale** | BCP 47 language tag, e.g. `en`, `fr`, `de` (defaults to `en`) |
| **Timezone** | IANA timezone string, e.g. `Europe/London`, `America/New_York` (defaults to `UTC`) |

Click **Create site**. The new site record is created immediately with a status of `active`, but it can't be accessed yet — see the next step.

### Step 3 — Copy the one-time setup link

Creating the site immediately shows a **setup link**: a URL of the form `https://example.com/setup?token=...`, next to a **Copy** button. This is your only chance to get it — only a hash of the token is stored, so if you navigate away without copying it, it cannot be shown again (delete the site record and create it again if that happens).

::warning
The token only works as part of that exact URL — there's no field anywhere to type or paste the token by itself. Visiting the bare domain (`https://example.com/setup` with no `?token=...` in the address) fails with **"Invalid or missing setup token."** Copy the full link and paste it directly into your browser's address bar.
::

Send that link to whoever will configure the site, or paste it into your own browser if that's you. Opening it runs the same 5-step Setup Wizard as a first install — site details, admin account, email settings, and a starter template (Landing, Blog, Portfolio, Blank) — and fully seeds the new site's content types, homepage, and taxonomies automatically. If whoever completes it already has an account (on any site), they enter that account's existing email and password in the admin-account step rather than creating a new one — NuxFlow checks the password and makes that account the new site's `admin`. (Not `super_admin`: that stays with the platform operator. A super admin can still grant it deliberately.)

A setup attempt that fails or is abandoned partway through doesn't consume the token, so the same link can be reused until setup completes successfully.

---

## Pointing a domain at the Worker

NuxFlow runs as a Cloudflare Worker, so new domains must be routed to it through the Cloudflare dashboard.

> [!IMPORTANT]
> **Can I add multiple custom domains to one Worker?**
> **Yes!** For **every single new site** you add, you should choose **Option A (Custom Domain)**. 
> - Do **not** switch to Option B (Worker Route) just because it is a second or third domain.
> - Cloudflare allows you to add up to **500 Custom Domains** mapped to a single Worker!
> - Choosing "Custom Domain" for every site is highly recommended because Cloudflare will automatically provision a free, dedicated SSL/TLS certificate for each domain and configure DNS records instantly.

### Option A — Custom Domain (recommended)

Use this option when your domain is on Cloudflare's nameservers.

1. Open **Workers & Pages → nuxflow → Settings → Domains & Routes**
2. Click **Add** → **Custom Domain**
3. Enter the bare hostname you registered in the site record (e.g. `example.com` or `shop.example.com`)
4. Cloudflare creates the DNS record and provisions a TLS certificate automatically

The domain is live as soon as the certificate is issued, which typically takes under two minutes.

### Option B — Worker Route

Use this option when your domain's DNS is managed outside Cloudflare. You must add a DNS record pointing to Cloudflare's proxy yourself before the route can receive traffic.

1. In your DNS provider, create an `A` record pointing the hostname to `192.0.2.1` with Cloudflare proxying enabled (orange cloud), **or** point the nameservers to Cloudflare and use Option A instead
2. In Cloudflare, open **Workers & Pages → nuxflow → Settings → Domains & Routes**
3. Click **Add** → **Route**
4. Enter the route pattern, e.g. `example.com/*`
5. Select the `nuxflow` worker

---

## Setting up & Administering the New Site

Because NuxFlow resolves your site context dynamically based on the request's hostname, **each site is administered by visiting the admin panel on its own domain.**

### 1. The Domain-Aware Dashboard
The admin dashboard is fully domain-aware. You do not manage your secondary sites from the primary `nuxflow.dev/admin` panel. Instead:
- To manage **`nuxflow.dev`**, you visit `https://nuxflow.dev/admin`.
- To manage **`xyz.com`**, you visit `https://xyz.com/admin`.

Any pages, blog posts, forms, media assets, or settings you create while logged into `https://xyz.com/admin` are strictly scoped to `xyz.com` and will never leak or display on your other domains.

### 2. Signing in
Visiting `https://xyz.com/admin` directly won't work until setup is completed on that domain — a newly created site record redirects any request to `/setup` and rejects it without the one-time token from Step 3 above. Complete setup via the copied setup link first.

After that, **Sign in** on `xyz.com` goes to the sign-in domain, shows xyz.com's name and logo, and comes straight back to `xyz.com/admin` signed in. Someone already signed in there (to any site) just passes through. The login they get on `xyz.com` works on `xyz.com` only; signing out on the sign-in domain signs them out of every site.

- **The platform operator (super admin)** can open any site's admin with read-only access, and runs platform actions (Super Admin → Sites, database export, suspending sites) from the main site.
- **Site teams:** once setup is complete, the site's admin invites editors and authors from **Admin → Users**. Their roles apply to that site only.
- **Account settings** — password, passkeys, connected Google/GitHub accounts, downloading your data, deleting your account — are on the sign-in domain's account page (`https://accounts.yourplatform.com/account`), not in any site's admin.

Each site's data is scoped by its internal site ID, so content, media, forms, and settings created here will never appear on other sites.

---

## Managing site status

Each site has one of three statuses that you can update via the API or the admin panel.

| Status | Behaviour |
|---|---|
| `active` | Normal operation — all requests are served |
| `maintenance` | Public pages return a 503 maintenance page; the admin panel and API remain accessible |
| `suspended` | Everything is closed — public pages, admin, API and sign-in — for everyone except a super admin; scheduled posts wait until it's reactivated |

To change a site's status, send a `PATCH` request to `/api/v1/admin/sites/:id`:

```bash
curl -X PATCH https://yourdomain.com/api/v1/admin/sites/SITE_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "maintenance"}'
```

You must be authenticated as a super admin for this request to succeed.

---

## Removing a site

Deleting always wipes everything the site owns: content, media, forms, settings, themes, and plugins. Users who exist solely on the deleted site are also removed; users with roles on other sites are left untouched. What happens to the `sites` row itself depends on which of the two delete paths you use.

### Super Admin → Sites (cross-site)

Send a `DELETE` request to `/api/v1/admin/sites/:id`, or use **Super Admin → Sites** in the dashboard:

```bash
curl -X DELETE https://yourdomain.com/api/v1/admin/sites/SITE_ID
```

You must be viewing a *different* site's domain than the one you're deleting — this endpoint refuses to delete the site you're currently on. It always fully removes the row, regardless of how many other sites exist. There's no confirmation step here and no undo.

After deleting, remove the corresponding Custom Domain or Route from the Cloudflare dashboard to stop routing traffic to the Worker for that hostname.

### Settings → Danger Zone (self-service, per-site)

The Danger Zone tab in **Admin → Settings** always targets whichever site's domain you're currently on, and behaves differently depending on whether that site is the **main** site — the oldest one in the deployment (there's no separate flag for this; it's simply whichever site has been around the longest) — or an **addon** site:

- **Only site in the deployment:** fully deleted, exactly like the cross-site path above. You're signed out and taken to the ordinary fresh-install `/setup` wizard.
- **Main site, while addon sites still exist:** blocked with a 409 and the list of addon domains that must be deleted first. The UI shows this list up front so you don't have to attempt the delete to find out.
- **Addon site:** fully deleted, same as the cross-site path — the row is dropped entirely rather than kept around in any reset state, so it doesn't linger as a phantom entry that would block a later main-site deletion. You're signed out here too: this delete only ever targets the domain you're currently on, and once that domain no longer has a site, a session cookie for it is meaningless — cookies don't carry over to your other domains anyway, since they're genuinely separate origins, not subdomains of one parent. You land on this domain's home page. To bring the deleted domain back, create it again from **Super Admin → Sites → New** on a site you can still reach — the same flow as adding any other new site — which issues a fresh one-time setup link.

::warning
Whichever path you use, ensure you have taken a D1 backup via **Cloudflare Dashboard → D1 → your database → Backups** before deleting a site with live content — a full delete has no undo.
::

---

## Social login across sites

Google and GitHub sign-in happen on the sign-in domain, so **one OAuth app serves every site** — there's nothing to set up per domain, and GitHub's one-callback-URL limit no longer matters.

- Register one callback URL per provider: `https://accounts.yourplatform.com/api/auth/callback/google` and `…/callback/github`.
- Enter the credentials either as the `NUXT_GOOGLE_CLIENT_ID` / `NUXT_GOOGLE_CLIENT_SECRET` / `NUXT_GITHUB_CLIENT_ID` / `NUXT_GITHUB_CLIENT_SECRET` variables, or in **Admin → Settings → Integrations → Social Login** on the main site (the settings win over the variables). Other sites don't show this setting.

See [Installation → Social Login](./installation.md#social-login-google--github) for creating the apps.

---

## Roles and access across sites

User accounts are global — a user can hold a role on any number of sites using the same login. Roles are always resolved against the site that handled the request, so a user with `editor` access on site A and `viewer` access on site B will see different permissions depending on which domain they are visiting. Someone with no role on a site can't open its admin at all.

`super_admin` is the platform operator's role. It gives read-only access to every site's admin, and platform actions (managing sites, the whole-database export) work only on a site where the operator actually holds `super_admin` — normally the main one.

**Inviting someone who already has an account.** Accounts are shared, so inviting an address that already exists adds a role to that account. If the account has never proven it owns its email address (not verified, and no staff role anywhere), the invitation waits instead: the person gets an "Accept invitation" email, and the role only appears once they set a password through it. The existing account is never changed or locked by an invitation.

**Deleting an account** removes it from every site, cancels its paid subscriptions on each site first, and is refused while the person is the only admin of any site.

See the [Installation Guide](./installation.md) for details on how to assign roles to users.

---

## Running Separate NuxFlow Instances

The multi-site approach described above — multiple domains on one Worker and one database — is the right choice for most hosting scenarios. However, there are cases where you might want to run **completely separate, independent NuxFlow deployments**, each with its own Worker, its own database, and no shared infrastructure:

- Hosting sites for different clients where strict billing or operational isolation is required
- Running a staging environment that is fully independent of production
- Segmenting categories of sites (e.g. a set of e-commerce sites on one instance, a set of blogs on another)

### The worker name is not baked into the code

Renaming or duplicating a NuxFlow deployment is a `wrangler.toml`-only change. No application code or server routes reference the worker name — it only appears in two places:

```toml
name = "nuxflow"          # The Worker's name on Cloudflare
database_name = "nuxflow" # The D1 database's display name (independent of the worker name)
```

The binding names that the application actually uses (`DB`, `PLUGIN_KV`, `LOADER`) stay the same regardless of what the worker or database is called. You can rename one, both, or neither — the code does not care.

### Setting up a second deployment

Start from `apps/nuxflow/wrangler.toml.example` and update the following before deploying:

**1. Change the worker name**

```toml
name = "my-blog-platform"
```

**2. Create and wire up a new D1 database**

```bash
wrangler d1 create my-blog-platform
```

Paste the returned `database_id` into the new `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-blog-platform"
database_id = "YOUR_NEW_DATABASE_ID"
```

**3. Create new KV namespaces**

```bash
wrangler kv namespace create PLUGIN_KV
wrangler kv namespace create PLUGIN_KV --preview
```

Paste both IDs into `[[kv_namespaces]]`.

**4. Set secrets for the new worker**

Pass `--name` to target the correct Worker:

```bash
wrangler secret put NUXT_BETTER_AUTH_SECRET --name my-blog-platform
```

Then build and deploy as normal. The second instance appears as a separate Worker in your Cloudflare dashboard, has its own D1 and KV, and shares no data with the first.

::note
Each NuxFlow instance runs its own setup wizard (`/setup`) and maintains its own user database. Super admin accounts do not cross instance boundaries — a super admin on one instance has no access to another.
::

---

## Gotcha: Custom Domains Being Wiped on Deploy? ⚠️

A common Cloudflare Wrangler gotcha in multi-site setups is custom domains being deleted or wiped every time you redeploy changes using `wrangler deploy` (or `pnpm run deploy`).

### Why this happens:
If your `wrangler.toml` file contains a declarative `[[routes]]` block, Wrangler assumes it has **exclusive ownership** over all domains and routes for that Worker. During deployment, Wrangler compares your active Cloudflare settings to `wrangler.toml` and **deletes** any custom domains or routes that were added in the dashboard but are missing from the configuration file.

### How to resolve it:
1. **Remove `[[routes]]` from configuration:** Delete the `[[routes]]` block completely from [wrangler.toml](file:///c:/DEV/NuxFlow/apps/nuxflow/wrangler.toml):
   ```toml
   # REMOVE THIS BLOCK ENTIRELY:
   [[routes]]
   pattern = "nuxflow.dev"
   custom_domain = true
   ```
2. **Add all domains in the dashboard:** Go to the Cloudflare Worker Dashboard under **Settings → Domains & Routes** and add **all** of your custom domains there manually (including your primary domain `nuxflow.dev`).
3. **Enjoy persistent routing:** Because `wrangler.toml` no longer specifies any routes, Wrangler switches to non-declarative routing mode and will **never** touch, alter, or delete any of your custom domains during deployment again!
