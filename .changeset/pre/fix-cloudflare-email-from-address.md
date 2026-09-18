---
"@nuxflow/app": patch
---

fix: Cloudflare Email binding rejects a from address with no display name

`sendViaCloudflareEmail` always sent `from: { email: from }` — an `EmailAddress` object with no `name` key. Cloudflare's `send_email` binding validates that object stricter than its published types suggest (`name` is marked optional) and rejects it with "Incorrect type for the 'name' field on 'EmailAddress'" when `name` is absent entirely. There's no display-name setting to attach here, so `from` is now passed as a plain string instead — `SendEmailMessage` already supports that shape, and it sidesteps the broken object entirely. This also fixes the same bug in the password-reset email path, which shares this function.

Also corrects `docs/installation.md`'s Cloudflare Email section, which conflated the `wrangler.toml` binding (already ships with NuxFlow, deployment-wide, nothing to add) with `wrangler email sending enable <domain>` (a genuinely per-domain step) into one instruction, and overstated the latter as a hard requirement — sends go through without it, so it's now framed as recommended for deliverability (SPF/DKIM) rather than mandatory, and called out as needed once per site's sending domain in a multi-site install.
