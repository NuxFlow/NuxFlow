---
"@nuxflow/app": patch
---

fix: setting up a second site with central sign-in

- **"Use Existing Admin" now asks for that account's password.** The setup wizard hid the password field in this mode while the server required it, so it always failed with "enter that account's current password".
- **After setup you choose which account continues.** If the browser was already signed in to the accounts domain as someone else (typically the platform's super admin), that account was silently signed in to the new site. Now only accounts with a role on the site continue automatically; everyone else, super admins included, sees "Continue to … ?" with "Use a different account".
- **A failed sign-in hand-off shows a "Try again" page** instead of silently starting over, which could loop endlessly on "Signing you in…" with the buttons stuck. The reason is written to the Worker logs.
