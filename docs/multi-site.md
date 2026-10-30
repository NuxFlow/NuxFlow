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

Send that link to whoever will configure the site, or paste it into your own browser if that's you. Opening it runs the same Setup Wizard as a first install — site details, admin account and a starter template (Landing, Blog, Portfolio, Blank); email uses Cloudflare Email by default, changeable later in Settings → Email — — and fully seeds the new site's content types, homepage, and taxonomies automatically. If whoever completes it already has an account (on any site), they enter that account's existing email and password in the admin-account step rather than creating a new one — NuxFlow checks the password and makes that account the new site's `admin`. (Not `super_admin`: that stays with the platform operator. A super admin can still grant it deliberately.)

A setup attempt that fails or is abandoned partway through doesn't consume the token, so the same link can be reused until setup completes successfully.

---

## Pointing a domain at the Worker

NuxFlow runs as a single Cloudflare Worker, so every site's domain — and the central sign-in domain — has to be routed to it. Cloudflare offers two ways: **Routes** and **Custom Domains**. Which one to use depends on whether hostnames share a parent domain.

> [!IMPORTANT]
> **Several hostnames under one domain (`yourplatform.com`, `accounts.yourplatform.com`, `site-a.yourplatform.com`, …) must use Routes, not Custom Domains.**
>
> Each Custom Domain gets its own certificate, and every one of those also lists the parent domain. Browsers reuse a secure connection opened for one hostname to fetch another the certificate covers; Cloudflare then sees a request for `yourplatform.com` arriving on a connection opened for `site-a.yourplatform.com` and refuses it with an **empty, unlogged `403`** (Chrome: "Access to … was denied"). It's intermittent, switches between sites depending on which you visited last, and never appears in your Worker's logs. With Routes, every hostname shares the domain's one wildcard certificate, which Cloudflare handles correctly.

### Option A — Routes with a wildcard (recommended for a platform domain)

Use this for your platform's own domain: the primary site, the accounts domain, and any sites you host as its subdomains. Once set up, **new subdomain sites need no Cloudflare changes at all**.

1. **DNS** — in the Cloudflare dashboard → your domain → **DNS** → **Records**, add two proxied (orange cloud) records. `100::` is a placeholder address used when a Worker answers instead of a server:

   | Type | Name | IPv6 address | Proxy |
   |---|---|---|---|
   | AAAA | `@` | `100::` | Proxied |
   | AAAA | `*` | `100::` | Proxied |

2. **Routes** — declare them in `apps/nuxflow/wrangler.toml` and deploy (`pnpm run deploy` from `apps/nuxflow`):

   ```toml
   [[routes]]
   pattern = "yourplatform.com/*"
   zone_name = "yourplatform.com"

   [[routes]]
   pattern = "*.yourplatform.com/*"
   zone_name = "yourplatform.com"
   ```

3. **Other Workers on the same domain** (e.g. a separate demo Worker at `demo.yourplatform.com`) need their own, more specific route such as `demo.yourplatform.com/*` — the most specific route always wins over the wildcard.

4. **`www` and other unused addresses** — the wildcard sends *every* subdomain to NuxFlow, including ones no site uses (`www.yourplatform.com`, typos). Those get a plain 404 "Site not found" page. To send `www` to your main site instead, add a redirect rule (a **single redirect**, not Bulk Redirects): your domain → **Rules** → **Overview** → **Templates** → **Redirect from WWW to root** → **Deploy**. It runs before the Worker, so NuxFlow needs no change. (If one of your sites *is* `www.yourplatform.com`, skip this.)

The domain's free Universal SSL certificate (`yourplatform.com` + `*.yourplatform.com`) covers everything, so there's nothing to wait for. Note that it covers one level of subdomain only: `a.yourplatform.com` works, `a.b.yourplatform.com` doesn't.

### Option B — Custom Domain (a customer's own, separate domain)

Fine when a site's domain is the **only** hostname this Worker serves in that Cloudflare zone — typically a customer's own domain such as `theircafe.co.uk`, which shares nothing with your platform domain.

1. Open **Workers & Pages → nuxflow → Settings → Domains & Routes**
2. Click **Add** → **Custom Domain**
3. Enter the hostname you registered in the site record (e.g. `theircafe.co.uk`)
4. Cloudflare creates the DNS record and certificate automatically, usually in under two minutes

If that customer later also wants `www.theircafe.co.uk`, switch that domain to Routes (Option A) instead of adding a second Custom Domain in the same zone, for the same reason as above. Domains on DNS outside Cloudflare need [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) (custom hostnames), which also uses routes.

### Email for each site

A new site can't email anyone outside your own Cloudflare account until its domain is onboarded for Cloudflare Email Sending, and that includes subdomains: `site-a.yourplatform.com` is onboarded separately from `yourplatform.com` (Cloudflare dashboard → **Email Service** → **Email Sending** → **Onboard Domain**, or `wrangler email sending enable site-a.yourplatform.com`). Until then, its invite and password-reset emails only reach addresses verified in your Cloudflare account, and the Users page warns that an invite email wasn't sent. See [Email Providers](installation.md#email-providers) for the details and the per-zone limit.

### Keep `wrangler.toml` and the dashboard in step

Wrangler treats the `[[routes]]` in `wrangler.toml` as the full list for this Worker: a route or Custom Domain added only in the dashboard is reported as drift on the next deploy, and Wrangler offers to remove it. Declare every route and Custom Domain in `wrangler.toml` (a Custom Domain is `pattern = "theircafe.co.uk"` plus `custom_domain = true`). With the wildcard route from Option A, subdomain sites never need an entry.

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

After that, **Sign in** on `xyz.com` goes to the sign-in domain, shows xyz.com's name and logo, and comes straight back to `xyz.com/admin` signed in. Someone already signed in there (to any site) just passes through. The login they get on `xyz.com` works on `xyz.com` only; signing out, from any site or from the sign-in domain, signs them out of every site.

- **The platform operator (super admin)** can open any site's admin with read-only access, and runs platform actions (Super Admin → Sites, Usage, database export, suspending sites) from the main site.
- **Site teams:** once setup is complete, the site's admin invites editors and authors from **Admin → Users**. Their roles apply to that site only.
- **Account settings** — password, passkeys, connected Google/GitHub accounts, downloading your data, deleting your account — are on the sign-in domain's account page (`https://accounts.yourplatform.com/account`), not in any site's admin.

Each site's data is scoped by its internal site ID, so content, media, forms, and settings created here will never appear on other sites.

---

## Running a hosting platform

Usage and hosting plans (the next two sections) are for selling sites to other people. They're hidden until you turn them on: **Super Admin → Platform → Run this install as a hosting platform**.

- **Off (the default):** every site is unlimited, plan limits and plan alerts don't run, and Super Admin has no Plans or Usage pages. Usage is still counted quietly in the background, so the numbers are there if you turn it on later.
- **On:** Super Admin gets **Plans** and **Usage**, and each site's plan limits apply.
- Turning it off again doesn't forget anything: each site keeps its plan, and the limits come back when you turn it on.
- Only a super admin can change it. It isn't part of a site backup, so restoring a site elsewhere never turns it on.

As a platform grows, its sites can be spread over several Workers and databases, and moved between them: see [Member Pools](./pools.md).

### Selling sites: sign-up and billing

With the switch on, people can sign up, pay and get a site without you doing anything. It uses your Stripe account and Stripe's own pages for payment and billing.

**What the customer sees**

1. Your sign-up page, on the sign-in domain: `https://accounts.example.com/account/hosting/new`. Link to it from your pricing page.
2. They pick a plan (monthly or yearly), name the site, choose an address such as `cornercafe.example-sites.com` and a starting layout, and create an account if they don't have one.
3. Stripe Checkout takes the payment (or the card, for a free trial).
4. A few seconds later their site exists: on the chosen plan, with them as its admin, and a "your site is ready" email.
5. **My hosting** (`/account/hosting` on the sign-in domain) lists their sites. **Billing** opens Stripe's Customer Portal: card, invoices, change plan, cancel.

**What happens when a payment fails ("grace, then pause")**

- While Stripe retries the card, the site stays online. The customer and you are told once.
- If Stripe gives up (it pauses the subscription), or the subscription ends, the site goes into **maintenance mode**: visitors see a "back soon" page, but the customer can still sign in, download a backup and pay. You're notified.
- When it's paid again, the site reopens by itself (unless you've changed its status yourself).
- **Nothing is ever deleted automatically.** You decide in Super Admin → Sites.
- Deleting a site that has a subscription cancels the subscription in Stripe first, so nobody is charged for a site that's gone.

**Setting it up**

1. In `wrangler.toml`, set the domain customer sites go under, and route it to the Worker with a wildcard route (see "Pointing a domain at the Worker"):
   ```toml
   NUXT_HOSTING_SITES_DOMAIN = "example-sites.com"
   ```
   Use a separate domain from your own site's, so one customer's misbehaving site can't get your main domain flagged.
2. Onboard that domain for Cloudflare Email Sending. Customer sites send from `noreply@example-sites.com` under their own site name (Cloudflare can only send from a limited number of subdomains per domain, so they share one).
3. On your main site, add your Stripe secret key in **Settings → Payments**.
4. **Super Admin → Platform** shows the webhook address and the six events to select. Create the webhook in Stripe (**Workbench → Webhooks → Create an event destination**: events from your account, **Snapshot** payload style, destination type Webhook endpoint) and paste its signing secret back on the Platform page.
5. In Stripe, set up the **Customer portal** (allow card updates, cancelling and switching between your plans). Then in **Billing → Revenue recovery → Retries**: if all retries fail, **Pause the subscription**, and when the invoice that caused the pause is paid, **Resume the subscription**. The site then reopens by itself once the customer pays. (Cancelling also works, but a customer who pays late then has to sign up again.)
6. In **Super Admin → Plans**, give a plan a monthly and/or yearly price, an optional free trial, and tick **Offer on the sign-up page**. NuxFlow creates the product and prices in Stripe. Changing a price later only affects new sign-ups.

Plans without a price still work as before: give them to sites by hand in Super Admin → Sites.

### Customers' own domains

Every customer starts on a subdomain of your sites domain (`cafe.example-sites.com`), which works the moment they've paid. They can then connect a domain they own (`www.cafe.co.uk`) from **My hosting → Addresses**:

1. They type the domain and click **Connect your own domain**. NuxFlow registers it with **Cloudflare for SaaS** on your sites domain (the first 100 domains are free, then $0.10 a month each).
2. They add the one CNAME record shown (pointing at your CNAME target, e.g. `customers.example-sites.com`) at whoever runs their domain's DNS.
3. NuxFlow checks every hour (or when they click **Check now**). Once Cloudflare has validated the domain and issued its certificate, they're emailed and it shows as **Working**.
4. **Make main address** makes it the site's address. Every other address of the site, including the original subdomain, then redirects to it, so old links and search results keep working.

Good to know:
- If the customer's domain uses Cloudflare, the record should be **DNS only** (grey cloud). Proxied works too (Cloudflare's "Orange-to-Orange"), but then the customer's own Cloudflare settings, such as caching and redirect rules, run before yours.
- A domain without `www` only works if the customer's DNS provider allows a CNAME at the root (Cloudflare DNS and many others call this CNAME flattening or ALIAS). Otherwise they connect `www.` and redirect the bare domain at their provider.
- Each plan's **Own domains** allowance sets how many a site may connect (0 = not included, empty = any number, up to 10).
- Removing a site removes its domains from Cloudflare too.
- This works the same for sites in a [member pool](./pools.md).
- Customer sites keep sending email from the shared sites domain, even on their own domain.

**One-time setup** (in the Cloudflare dashboard, on your sites domain's zone):
1. DNS: add a proxied `AAAA` record named `customers` with address `100::`.
2. **SSL/TLS → Custom Hostnames**: enable Cloudflare for SaaS and set `customers.example-sites.com` as the **fallback origin**.
3. In `wrangler.toml`, route the whole zone to the Worker with the pattern `*/*` (instead of `*.example-sites.com/*`), so customers' domains reach NuxFlow.
4. Create an API token with **Zone → SSL and Certificates → Edit** for that zone only, and enter it with the zone ID on **Super Admin → Platform → Customers' own domains**.

---

## Usage

**Super Admin → Usage** shows what each site uses, one calendar month (UTC) at a time. Pick a month at the top, select a column heading to sort, and select a site's name to see its last 30 days as small daily charts.

| Column | What it counts | When it updates |
|---|---|---|
| **Views** | Public page requests, including pages served from the cache | About once a minute |
| **Renders** | Pages the server had to build (cache misses, admin pages). Rendering is most of a Worker's CPU time, which a Worker can't measure itself, so this is the closest stand-in. | About once a minute |
| **API** | Requests to the site's `/api` routes | About once a minute |
| **AI calls** | Every call to an AI model: writing tools, page generation, images, dictation, "Listen to this article", spam checks. Includes calls on a site's own API key. | About once a minute |
| **AI credits** | AI you pay for (see [AI on a hosting platform](#ai-on-a-hosting-platform)), weighted by cost. This is what plans limit. | About once a minute |
| **Emails** | Recipients an email provider accepted (failures and console-only sends aren't counted) | About once a minute |
| **Storage** | Total size of the media library | Nightly, 3 AM UTC |
| **Pages** | Pages, posts and other content, in any status | Nightly |
| **Team** | People with any role except member (viewer and above), not counting super admins | Nightly |
| **Members** | People with the member role | Nightly |
| **Plugins** | Installed plugins | Nightly |

A **—** means no nightly total has been taken for that site yet.

Good to know:

- **The numbers are approximate, on the low side.** Counts are added up in memory and saved about once a minute, so a busy site costs one small database write a minute, not one per visit. Counts not yet saved when Cloudflare recycles a Worker instance are lost. Nothing is ever counted twice.
- **No visitor data is stored.** Usage is a number per site, per day, per measure: no IP addresses, cookies or page addresses.
- **History is kept for 400 days**, so you can compare a month with the same month last year.
- Usage is only shown in Super Admin. A site's admins see their own usage only when their site is on a plan with limits (see below).

---

## Hosting plans

**Super Admin → Plans** is where you set what each site may use. A plan has a name, a price (shown only; payment is separate), a description, and a box for each limit. **Leave a box empty for unlimited.** A site with no plan is on the built-in **Unlimited** plan, so nothing changes for anyone until you create a plan and choose it for a site in **Super Admin → Sites** (edit the site, then pick a **Hosting plan**). Changes take effect within a minute.

| Limit | Kind | What happens at the limit |
|---|---|---|
| **Storage** | Hard | Uploads are refused: "Your plan's storage is full". This covers the media library, AI images, imported and restored media, theme images and emailed-in images, plus received email kept in storage (the original message and its attachments). When it's full, new emails still arrive in the inbox but their attachments aren't kept, and the site's admins are told once that month. |
| **Pages and posts** | Hard | New pages and posts are refused: from the editor, AI generation, translation, WordPress import, restore, post-by-email and the MCP tools. |
| **Team members** | Hard | Inviting someone, or changing a member into a team role, is refused. Pending invitations count. |
| **Site members** | Hard | Sign-ups and "join this site" are refused: "This site isn't accepting new members". |
| **Plugins** | Hard | Installing is refused. Set it to 0 for a plan without plugins. |
| **AI credits a month** | Hard | The site team's AI on Workers AI (writing tools, page generation, image descriptions) is refused until the 1st, with a message telling the site it can add its own AI key. AI on the site's own key is never limited. Set it to 0 for a plan where customers bring their own key. |
| **Visitor AI credits a month** | Hard | AI that visitors, incoming mail and plugins set off: "Listen to this article", spam checks on comments and forms, inbox sorting, smart search and plugin AI. It has its own allowance so a bot hammering a public feature can never use up the team's. At the limit these features pause until the 1st (smart search falls back to keyword search, spam checks are skipped); nothing else stops. |
| **Emails a month** | Hard | Ordinary emails (form notifications, notices, inbox replies) are held back until the 1st. **Sign-in, password, invitation and security emails always go out.** |
| **Emails received a month** | Hard | Mail to the site's own addresses (inbox and post-by-email) is no longer kept until the 1st. Mail set to forward still forwards. The site's admins are told once that month. |
| **Own domains** | Hard | Connecting another of the customer's own domains is refused. 0 means not included. |
| **Video minutes stored** | Hard | Uploading to your Cloudflare Stream account is refused once the site's videos add up to this many minutes, and an upload longer than what's left is stopped by Stream itself. 0 (the default, also for plans made before this existed) means no video uploads; YouTube and Vimeo links always work. Customers who add their own Stream account in Settings → Media aren't counted. Stream bills you $5 a month per 1,000 minutes stored, plus $1 per 1,000 minutes watched (limited by the row above). |
| **Video minutes watched a month** | Hard | Minutes of the site's videos in your Stream account that visitors watch, counted hourly from Stream's analytics. **Needs the analytics API token** (Account Analytics Read) on Super Admin → Platform → Visitor analytics; without it nothing is counted, so nothing is enforced. At the limit the site's uploaded videos pause until the 1st (Stream is told to require signed links, and none are given out), its admins are told, and you get the usual 80% and 100% notices. Raising the plan plays them again within the hour. 0 (the default) means none, so set it whenever you set **Video minutes stored**. Analytics arrive a few minutes late, so a site can go slightly over before it's paused. |
| **Page views a month** | Soft | Nothing is blocked. |
| **Server renders a month** | Soft | Nothing is blocked. |
| **Plugin requests a month** | Soft | Nothing is blocked. Each plugin request or event runs the plugin on your Cloudflare account. (Each visitor is also limited to 120 requests a minute per plugin.) |
| **Database size** | Soft | Nothing is blocked. Roughly how much of the shared database the site's pages, revisions, emails, form entries, comments and plugin data take, measured nightly. |

A plan also has **included features**: things that cost you money per use and are off unless you tick them.

| Feature | What it does |
|---|---|
| **Image resizing (Cloudflare Image Transformations)** | Lets the site turn on Image Transformations in Settings → Media. They're billed to your Cloudflare zone (5,000 unique transformations a month free, then $0.50 per 1,000), whichever domain the site uses. Without it the switch is locked; a site moved to a plan without it stops using it straight away. |

Monthly limits reset on the 1st of the month (UTC).

**Notifications for you.** Once an hour NuxFlow checks every site on a plan. When a site reaches **80%** or **100%** of a monthly limit, or of its database size, you get a notification and an email on your main site, once per limit per month. For soft limits that's all that happens: you decide whether to talk to the customer, move them to a bigger plan, or put the site into maintenance mode.

**What the site owner sees.** On a plan with limits, a site's admins get a **Your plan** card on their dashboard showing each limit and how much they've used. On the Unlimited plan they see nothing.

**Good to know:**

- Nothing is ever deleted to fit a plan. A site that's already over a limit when you choose a smaller plan keeps everything; it just can't add more.
- Deleting a plan moves its sites back to Unlimited.
- A visitor never sees a broken page because of a plan. Public pages are never blocked; traffic limits are soft only.
- Monthly counts are saved about once a minute, so a site using AI or email very fast can go slightly over its allowance before it's refused.

### AI on a hosting platform

A customer site's AI runs in one of two ways:

- **On Workers AI, paid by you.** That's the default for any site that hasn't added its own key. It's billed to your Cloudflare account, so it's counted as **AI credits** and limited by the plan: **AI credits a month** for what the site's team does, **Visitor AI credits a month** for what visitors, incoming mail and plugins set off. Smart search always runs on Workers AI (its index needs one fixed model), so its embeddings are always counted: 1 credit each, to the team when a page is saved, to visitors for a search.
- **On the site's own key.** A site that adds an OpenAI, Anthropic, Gemini or DeepSeek key in **Settings → AI** pays that provider directly. Its AI is never counted against its plan or the daily cap, and never refused by them.

**Your own keys stay yours.** While hosting is on, these env vars in `wrangler.toml` are used only by your main site, and customer sites never fall back to them:

- AI keys, the AI provider choice and the AI Gateway settings.
- Cloudflare Stream and Cloudflare Images (account ID and tokens). A customer site's images go to the shared R2 bucket instead, which the plan's storage limit counts. A customer site without its own Stream details uploads video into your Stream account, counted against the plan's **Video minutes stored**; the customer never sees your token. Pools receive the Stream token with the other platform settings (Super Admin → Pools → Send platform settings, or automatically when you save it).

**No Ollama for customer sites.** Ollama is hidden from customer sites' Settings → AI and refused if set some other way. A Worker can't reach anyone's own computer, and allowing it would let a customer make your Worker send requests to any address they type in. Your main site can still use it.

**How credits are counted.** Credits follow what the AI costs, not how many times someone clicks:

| AI use | Credits |
|---|---|
| Writing tools, SEO suggestions, spam checks (fast model) | 1 per 1,000 tokens (prompt plus answer), so usually 1–3 |
| Page and site generation, image descriptions, translation (larger model) | 5 per 1,000 tokens, so a generated page is usually 20–60 |
| Generating an image | 10 |
| Dictation | 2 |
| "Listen to this article" | 1 per 1,000 characters read |
| Smart search (indexing a page, or one search) | 1 |

Every call costs at least 1 credit, including one that fails. The numbers are relative weights, not a price: compare them with the Workers AI line on your Cloudflare bill to decide what to put in each plan.

**The daily cap.** On **Super Admin → Platform → AI you pay for** you can set the most credits (team and visitor together) all customer sites may use in one day (UTC). It's a safety brake on top of the plans, for example in case a plan's AI box was left empty. Once it's reached, Workers AI pauses for every customer site until midnight UTC, and they're told they can add their own key to keep going. Your main site is never paused. You get a notification at 80% and 100%. Leave the box empty for no cap.

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

Deleting always wipes everything the site owns: content, media, forms, settings, themes and plugins, and also what it keeps outside the database — every file in storage, received email, videos in Cloudflare Stream, search entries, and its data in KV (every saved version of its themes, plugin code, its video signing keys).

Before anything is removed, NuxFlow cancels the site's paid subscriptions:

- **Members' memberships** are cancelled with the site's payment provider, so nobody keeps being charged for a site that's gone. Stripe and Paddle end them at once; Lemon Squeezy can only end them at the end of the paid period, which still stops every renewal.
- **The site's hosting subscription**, if a customer pays for it, is cancelled in Stripe.

If a provider can't be reached, the deletion is refused and nothing is changed. Cancel the subscription with the provider yourself, then try again.

Accounts that only belonged to the deleted site are removed too. That includes accounts created by an invitation to the site that was never accepted. An account is kept if the person still has a role or a pending invitation on another site — including a site in a [member pool](pools.md) — or a hosting subscription for another site. If a pool can't be reached to check, every account is kept.

A site that is being moved between pools can't be deleted until the move finishes or is cancelled (a failed move must be cancelled first). What happens to the `sites` row itself depends on which of the two delete paths you use.

### Super Admin → Sites (cross-site)

Send a `DELETE` request to `/api/v1/admin/sites/:id`, or use **Super Admin → Sites** in the dashboard:

```bash
curl -X DELETE https://yourdomain.com/api/v1/admin/sites/SITE_ID
```

You must be viewing a *different* site's domain than the one you're deleting — this endpoint refuses to delete the site you're currently on. It always fully removes the row, regardless of how many other sites exist. There's no confirmation step here and no undo. Sites in member pools are deleted from here too: the pool first cancels the members' subscriptions (and refuses if it can't), then the control panel cancels the site's hosting subscription, removes its own domains from Cloudflare, has the pool delete the site, updates the routing, and removes the accounts nothing needs any more.

If some files or domains couldn't be removed, the response lists them (`failedMediaDeletes`, `leftoverDomains`) instead of an empty `204`, and **Super Admin → Sites** shows them until you close the notice. Remove those by hand in your storage provider or under **SSL/TLS → Custom Hostnames** in Cloudflare.

After deleting, remove its Custom Domain (Option B) from the Cloudflare dashboard and from `wrangler.toml`. A subdomain served by the wildcard route (Option A) needs no change: with no site record, its address shows a 404 "Site not found" page.

### Settings → Danger Zone (self-service, per-site)

The Danger Zone tab in **Admin → Settings** always targets whichever site's domain you're currently on, and behaves differently depending on whether that site is the **main** site — the primary site, set by the first-ever install — or an **addon** site:

- **Site in a member pool:** refused. Delete it from **Super Admin → Sites** on the control panel, which also cancels its hosting subscription and removes its domains.
- **Only site in the deployment:** fully deleted, exactly like the cross-site path above. You're signed out and taken to the ordinary fresh-install `/setup` wizard.
- **Main site, while addon sites still exist:** blocked with a 409 and the list of addon domains that must be deleted first — including sites in member pools, which depend on the main site's settings just as much. The UI shows this list up front so you don't have to attempt the delete to find out.
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
