---
"@nuxflow/app": minor
---

Add Cloudflare Stream and Images credentials to the admin settings UI.

Previously, `NUXT_CLOUDFLARE_ACCOUNT_ID` and `NUXT_CLOUDFLARE_STREAM_TOKEN` had to be set as environment variables or wrangler vars before video uploads would work — there was no UI and the failure was silent (the frontend never showed an error toast because the request never began).

- New **Settings → Media** tab with Cloudflare Stream and Cloudflare Images sections, including setup instructions and a link to where each credential is found in the Cloudflare dashboard
- Stream token and Images token are stored encrypted at rest (AES-GCM, same as AI API keys)
- All Cloudflare credentials (account ID, stream token, images token, delivery URL) now read from DB settings first with env var fallback — no wrangler redeploy required when credentials change
- Refactored `getActiveProvider()` to accept an H3 event and resolve credentials via `resolveSetting()` across all 8 call sites (upload, media delete, themes, restore, WordPress import, AI image generation, site deletion)
- Error message on unconfigured Stream now points to Settings → Media instead of a generic note
