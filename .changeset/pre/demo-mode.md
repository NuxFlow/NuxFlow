---
"@nuxflow/app": patch
---

A proper demo mode for public demo deployments (`NUXT_IS_DEMO = "true"`).

- AI is always off in the demo, whatever bindings or keys the Worker has.
- The shared demo login is now an admin, not a super admin, so the platform screens aren't reachable.
- Account changes, API keys, MCP, plugins, the setup wizard, restore/import, video uploads, theme uploads, custom HTML (settings and the HTML block) and credential settings are refused with "This is switched off in the live demo."
- Uploads are images only, up to 2 MB, and every page is sent with `noindex`.
- The admin shows a "You're in the live demo" notice.
- The nightly reset now wipes every table, and a fresh demo database seeds itself without waiting for a visitor.
