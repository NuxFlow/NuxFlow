---
"@nuxflow/app": patch
---

fix: resolve pnpm hoisting issues for ESLint and Better Auth

- Set `shamefully-hoist=true` in `.npmrc` to guarantee strict module resolution for Nuxt ESLint config.
- Pinned `kysely` to `0.28.5` via `pnpm.overrides` in `package.json` to prevent `@better-auth` from crashing during the Cloudflare Nitro build process when `kysely` v0.29 is improperly hoisted.
