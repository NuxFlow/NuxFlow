---
"@nuxflow/app": patch
---

fix: onboarding Enter-key on site name and Cloudflare-first email defaults

Step 1 (site name) was the only onboarding field with no `@keyup.enter` handler, so Enter silently did nothing there while it worked one step later on the admin-account step.

Also traced the Email step: nothing in onboarding actually depends on email working (no verification email or password-reset email is ever sent during setup — the wizard's provider choice only seeds the `email.provider` site setting, identical to configuring it in Settings afterward). Given that, it's safe to lead with the zero-setup option: defaults to `cloudflare` instead of `console`, and drops the dev-only Console entry from the onboarding picker (still available in Settings → Email for local dev use).
