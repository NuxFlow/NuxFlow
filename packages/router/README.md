# NuxFlow front-door router

Optional. Only for a hosting platform that spreads its sites over several Workers
("member pools"). A single NuxFlow install, or one Worker hosting several sites, never
needs it.

The router takes every request for your customer addresses and passes it, untouched, to
the Worker that serves that address:

- an address listed in the **site directory** goes to that member pool
- any other address goes to the **control plane** (your main NuxFlow Worker), exactly as
  if the router weren't there

The control plane keeps the directory up to date from what its pools report: every hour,
and when you press **Update routing** on Super Admin → Pools. It writes a copy to its
`PLUGIN_KV` namespace, which the router reads (answers are cached for up to a minute).

## Set up

1. Copy `wrangler.toml.example` to `wrangler.toml` (gitignored) and fill in:
   - the control plane's `PLUGIN_KV` id
   - its Worker name
   - one `POOL_<ID>` service binding per pool (`pnpm pool:create` prints it)
2. Deploy from this folder:

   ```bash
   pnpm exec wrangler deploy
   ```

3. Move the `*/*` route for your customer sites zone from the control plane's config to
   the router's, and deploy both. Test on a single hostname route first.

Redeploy the router when you add a pool, so it gets the new binding.

## Check on a real deploy

`wrangler dev` isn't the real network. Before trusting the router with customers, check
through it that:

- pages load
- the page cache still answers `x-nuxflow-page-cache: HIT` on a second load
- signing in works
- the audit log shows your real IP address
- Analytics shows the right country
