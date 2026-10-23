# Member Pools

A hosting platform can spread its sites over several Workers, each with its own D1
database. Each extra Worker is a **member pool**. Pools let you:

- keep a particular client's sites apart from everyone else's, in their own database;
- give new releases to some sites first (see [Release rings](./release-rings.md));
- keep each D1 database well under its 10 GB limit as the platform grows.

**An ordinary install never needs any of this.** With no pools, nothing on this page
applies, and nothing extra has to be set up.

## How it fits together

| Part | What it does |
|---|---|
| **Control plane** | Your main deployment (e.g. nuxflow.cloud). Sign-in, billing, plans, Super Admin and platform settings all live here. It can also hold sites itself. |
| **Member pool** | Another deployment of the same code, with `NUXT_POOL_ID` set. It holds sites only. |
| **Router** | A small Worker (`packages/router`) on the customer sites' domain. It sends each request to the pool that holds that address, or to the control plane. |

The control plane talks to each pool over a private **service binding**, never over the
internet. A pool is "connected" simply by having that binding in the control plane's
wrangler config. Everyone signs in once, at the control plane's sign-in domain, and that
sign-in works on sites in every pool.

## Creating a pool

From `apps/nuxflow`:

```bash
pnpm pool:create <name> --from wrangler.cloud.toml [--ring 1|2] [--location weur]
```

It creates the pool's D1 database and KV namespace, writes its config
(`wrangler.pool-<name>.jsonc`, not committed), deploys it with its own secret, and adds
it to `release-targets.json`. Running it again is safe: it finds what already exists.

It then prints two snippets:

1. A service binding for the **control plane's** config. Add it and deploy the control plane.
2. A service binding for the **router's** config. Add it and deploy the router.

Then open **Super Admin → Pools** and click **Send platform settings**. The pool shows
its release, its newest database migration and its sites.

The router's own setup is in `packages/router/README.md`.

## Putting sites in a pool

- **By hand:** Super Admin → Sites → **New site** → *Where*: pick the pool and enter the
  owner's name and email. The owner gets an email to set their password, or a "your site
  is ready" email if they already have an account.
- **Sign-ups from your shop:** in Super Admin → Plans, set **Sign-ups get their site in**
  on a plan. New customers on that plan get their site in that pool. If the pool isn't
  connected, the site is made on the control plane instead and you're told.

Sites in a pool work like any other: billing, plans and limits, usage, invitations,
**inbound email** (mail still arrives at the control plane and is passed on), and
**customers' own domains** (My hosting → Addresses).

## Moving a site to another pool

Super Admin → Sites → the **Move** button (two arrows) on the site's row. Choose where
it goes: another pool, or the control panel itself. A move takes a few minutes:

1. **Pause changes.** Visitors see the "down for maintenance" page. The site's team can
   look around the admin but can't save. NuxFlow waits about 35 seconds, so every server
   has noticed the pause.
2. **Copy.** Everything the site owns is copied, with the same IDs: pages, posts, media
   records, forms and answers, inbox, members and their memberships, mailing list, plugins
   and their stored data, themes, settings, redirects, usage history. Media files and
   email attachments stay where they are, because every pool shares one R2 bucket.
3. **Check.** Mail that arrived during the copy is copied too. Then the number of rows in
   every table must match on both sides. If anything doesn't match, the move stops and
   nothing is switched.
4. **Switch.** The copy goes live and the router sends the site's addresses to it.
5. **Remove the old copy**, about a minute and a half later, once the router has caught up.

Keep the dialog open until it's done. If you close it, the move pauses (the site stays
paused) and the Sites page shows a banner to continue it. Until the switch, **Cancel move**
removes the copy and unpauses the site where it was.

Good to know:

- People signed in to the site have to sign in again.
- If the site uses the **shared email address** (`name+box@your-inbound-domain`), that
  address changes, because a pool's addresses carry the pool's name. The site's
  **Inbox → Addresses** page shows the new one. Addresses on the site's own domain don't
  change.
- Scheduled posts that fall due during the move go out just after it, from the new home.
- The platform's own main site can't be moved.
- As a further safety net, every D1 database keeps 30 days of history
  ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)), so the
  old database can be restored to a moment before the move if ever needed.

## Known limits

- "Set your password" and sign-in emails for sites in a pool are sent with the
  platform's branding, not the site's.
- The daily AI credit cap (Super Admin → Platform) is counted separately in each pool.
