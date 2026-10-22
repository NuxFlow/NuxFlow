---
"@nuxflow/app": patch
---

Admin and account buttons now report results the same way everywhere.

- Every failed action shows what failed ("Couldn't delete theme") with the server's reason underneath, instead of a mix of styles.
- Buttons in lists (themes, passkeys, comments, subscribers, redirects, domains and more) show their own spinner, so working on one row no longer looks like it affects the others.
- Passkey and linked-account errors returned by the sign-in service are now reported instead of being missed.
