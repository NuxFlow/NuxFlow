---
"@nuxflow/app": patch
---

Security fixes from the November 2026 sweep.

- A hosting customer can no longer reopen a site paused for non-payment from Settings
- Close the public verification-email endpoint, which let anyone send unlimited email to unverified accounts
- Visitors can no longer fake plugin event hooks with a double-slash path
- The sign-in state cookie is `__Host-`, so a site on a sibling subdomain can't set it
- Page passwords also have a limit per page, not just per visitor
- MCP `get_content` no longer returns a page password's hash or a preview link
- Listing content with an API key needs the `read:content` scope to see drafts
- The theme preview cookie only works for a site's admins
- Limit the number and length of checkbox values on form submissions
