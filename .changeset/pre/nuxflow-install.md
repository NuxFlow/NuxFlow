---
"@nuxflow/app": minor
"create-nuxflow-app": patch
---

feat: `pnpm nuxflow:install`, a one-command install on your own Cloudflare account

- New `pnpm nuxflow:install` creates the D1 database, KV namespace and R2 bucket, fills in `wrangler.toml` (keeping its comments), creates the auth secret, deploys, and prints the setup wizard link. Safe to rerun; rerunning is also how you deploy updates.
- `create-nuxflow-app`'s "Next steps" now point to `pnpm nuxflow:install` for going live.
