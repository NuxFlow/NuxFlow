---
"@nuxflow/app": minor
---

feat: self-service site deletion with main/addon-aware blocking

Settings → Danger Zone's delete button called the wrong endpoint (the super-admin cross-site route, which explicitly refuses to delete the site you're currently viewing) and had no error handling, so it silently 409'd on every attempt. Added a proper self-service `DELETE /api/v1/settings` endpoint scoped to the caller's current site.

In a multi-site install, deletion is now aware of which site is "main" (the oldest one — there's no separate flag for it): deleting the last remaining site resets to fresh-install onboarding as before, but deleting the main site while other sites still exist is blocked with a 409 and the list of sites that must go first (shown in the UI up front, not just as an error after clicking). Deleting an addon site is a full delete like any other — an earlier iteration kept the row around in a reset state to hand back an instant new setup link, but that left it permanently counting as a "blocking" sibling for the main site, so it's a straightforward delete now; re-provisioning an addon domain goes through the normal Super Admin → Sites → New flow.

Every successful delete now signs the admin out: a session cookie for a domain that no longer has any site is meaningless, and doesn't carry over to the admin's other domains anyway since they're separate origins with separate cookie jars, not subdomains of one parent. Lands on `/setup` or `/login` depending on whether it was the last site, after a brief countdown so the confirmation is actually readable.

Also restricts the multi-site single-site-fallback's domain self-heal to `/admin` traffic only. Previously any request to an unmatched host — including a bot hitting `/robots.txt` — could silently reassign the sole site's stored domain away from its real production domain if a second, never-onboarded domain was also routed to the same Worker.

`docs/multi-site.md` documents both site-deletion paths (Super Admin → Sites cross-site vs. Settings → Danger Zone self-service) and the main/addon blocking behavior.
