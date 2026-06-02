# Multi-Site Hosting

A single NuxFlow deployment can host any number of independent websites, each on its own domain. All sites share one Cloudflare Worker and one D1 database, but their content, users, settings, themes, and plugins are completely isolated from one another.

## How routing works

Every incoming request carries a `Host` header. The multi-site middleware reads that header and looks up a matching record in the `sites` table. Everything downstream — content queries, authentication, permissions, and plugins — is scoped to the resolved site.

If no site matches the incoming domain, NuxFlow falls back to a single-site rule: if there is exactly one site in the database, all requests are served by that site regardless of the domain. This allows you to access your admin panel after migrating to a new domain before you have updated the record, and it automatically heals the stored domain to match the live request when running in production.

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

## Adding a new site

New sites are created from within the super admin panel of any existing NuxFlow instance. You must be logged in with a `super_admin` role.

### Step 1 — Open the Sites panel

In the admin sidebar, scroll to the **Super Admin** section at the bottom and click **Sites**. This page lists every site in the deployment and their current status. The section is only visible to users with the `super_admin` role.

### Step 2 — Create the site

Click **New site** and fill in the following fields:

| Field | Description |
|---|---|
| **Site name** | A human-readable label shown in the admin panel |
| **Domain** | The bare hostname the site will respond to, e.g. `example.com` |
| **Default locale** | BCP 47 language tag, e.g. `en`, `fr`, `de` (defaults to `en`) |
| **Timezone** | IANA timezone string, e.g. `Europe/London`, `America/New_York` (defaults to `UTC`) |

Click **Create site**. The new site is created immediately with a status of `active`.

::note
Visiting the new domain for the first time will automatically trigger the Setup Wizard, which will pre-populate the site's name and domain. From there, you can choose a theme template (Landing, Blog, Portfolio, etc.) to seed all required standard content types and default canvas blocks automatically!
::

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

### 2. Logging in for the First Time
When visiting a newly created domain's admin panel for the first time, you do not need to register a new user account:
- **Global Super Admins:** Your primary site's `super_admin` credentials work across **all** domains in the deployment. Simply log in using your existing super admin email and password on `https://xyz.com/admin`.
- **Tenant Scope:** Once logged in as a super admin, you can configure the site and invite local users (such as editors or authors) who will be scoped strictly to that specific site.

Because `requireSuperAdmin` is not scoped to a single site, your existing super admin account has access to every site's admin panel. From here you can:

- Add content types under **Admin → Content Types**
- Create pages and posts under **Admin → Content**
- Configure themes, plugins, and settings for this site in isolation from your other sites

Each site's data is scoped by its internal site ID, so content, media, forms, and settings created here will never appear on other sites.

---

## Managing site status

Each site has one of three statuses that you can update via the API or the admin panel.

| Status | Behaviour |
|---|---|
| `active` | Normal operation — all requests are served |
| `maintenance` | Public pages return a 503 maintenance page; the admin panel and API remain accessible |
| `suspended` | Reserved for administrative use; treat as equivalent to maintenance |

To change a site's status, send a `PATCH` request to `/api/v1/admin/sites/:id`:

```bash
curl -X PATCH https://yourdomain.com/api/v1/admin/sites/SITE_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "maintenance"}'
```

You must be authenticated as a super admin for this request to succeed.

---

## Removing a site

Deleting a site is permanent and cascades to all data owned by that site: content, media, forms, settings, themes, and plugins. Users who exist solely on the deleted site are also removed; users with roles on other sites are left untouched.

To delete a site, send a `DELETE` request to `/api/v1/admin/sites/:id`:

```bash
curl -X DELETE https://yourdomain.com/api/v1/admin/sites/SITE_ID
```

After deleting, remove the corresponding Custom Domain or Route from the Cloudflare dashboard to stop routing traffic to the Worker for that hostname.

::warning
There is no confirmation step and no undo. Ensure you have taken a D1 backup via **Cloudflare Dashboard → D1 → your database → Backups** before deleting a site with live content.
::

---

## Roles and access across sites

User accounts are global — a user can hold a role on any number of sites using the same login. Roles are always resolved against the site that handled the request, so a user with `editor` access on site A and `viewer` access on site B will see different permissions depending on which domain they are visiting.

`super_admin` is the only role that crosses site boundaries. A user holding `super_admin` on any site can create and manage all sites in the deployment. All other roles are strictly site-scoped.

See the [Installation Guide](./installation.md) for details on how to assign roles to users.

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
