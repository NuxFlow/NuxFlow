# create-nuxflow-app

## 0.1.2-beta.0

### Patch Changes

- e4d1b14: refactor: eliminate fake "bundled plugins", promote canvas blocks to core, squash migrations

  **Architecture cleanup — bundled plugins removed**
  - Deleted `packages/plugins/` entirely (contact-form, html-block, payments, and the old canvas copy)
  - Canvas package moved from `packages/plugins/canvas` to `packages/canvas` and renamed `@nuxflow/plugin-canvas` → `@nuxflow/canvas`
  - "Plugin" in the codebase now means exactly one thing: a signed, independently-installable dynamic Cloudflare Worker extension

  **Canvas block categories**
  - Removed `'plugin'` category; added `'forms'`, `'advanced'`, and `'commerce'` categories
  - Contact Form block promoted to `CANVAS_BLOCKS` under `'forms'`
  - HTML Block promoted to `CANVAS_BLOCKS` under `'advanced'`
  - Membership Pricing block promoted to `CANVAS_BLOCKS` under `'commerce'`
  - Block picker "Plugins" section renamed "Extensions"; only appears when true dynamic plugin blocks are installed

  **CLI scaffold template**
  - `BlockDefinition.category` updated to reflect new category set (removed `'plugin'`, added `'forms'|'advanced'|'commerce'`)
  - Example block defaults to `'advanced'` category

  **create-nuxflow-app — Linux install fix**
  - Build output moved from `dist/` to `bin/` (not gitignored)
  - `bin/index.js` is now committed so `pnpm install` inside a freshly scaffolded project can link the bin without requiring a `prepare` run first

  **DB migrations squash**
  - Migrations 0001–0008 collapsed into `0000_baseline.sql` with all `ALTER TABLE` columns folded into their `CREATE TABLE` statements
  - Clean starting point for beta
