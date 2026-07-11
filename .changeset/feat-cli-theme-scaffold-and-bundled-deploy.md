---
"@nuxflow/cli": minor
---

feat: `nuxflow theme create`/`deploy`/`update` overhaul — correct design tokens, full block reference, and bundled-theme (zip + demo content) support

**`theme create`** previously scaffolded a `theme.css` with invented tokens (`--color-primary-500`, `--font-sans`, etc.) that nothing in the app reads, and no documentation of the Canvas block selector contract. It now generates:
- The actual live tokens (`--nuxflow-primary`, `--nuxflow-font`) that Admin → Appearance injects into every page
- A full reference of the 17 Canvas blocks that expose a stable root class, plus `.nux-blocks`/`.nux-content`

**`theme deploy`** previously could only ever POST bare `{ name, version, css }` — themes with seed content (pages, menus, forms, settings) had no path to ship through the CLI at all, only through a hand-built zip uploaded via the admin UI. It now auto-detects a `demo.json` and/or `images/` folder in the theme directory and, when present, zips `theme.css` + `theme.json` + `demo.json` + `images/*` and multipart-uploads it to the same `/api/v1/themes` endpoint the admin zip-upload UI uses — via a new `apiPostZip` helper in `utils/api.ts`. Bare-CSS themes are unaffected and still deploy as plain JSON.

`theme update` is unchanged — the CSS-patch endpoint is CSS-only by design, so demo-content changes require a fresh `deploy`.
