---
"@nuxflow/app": minor
"@nuxflow/db": minor
---

feat: email inbox, post-by-email, and security/system alerts built on Cloudflare Email Routing and Email Sending

**Inbox**
- Email sent to `contact@`, `leads@`, or any address you create lands in **Admin → Inbox**. Addresses are created in NuxFlow with no DNS or Cloudflare change per address: each domain needs one catch-all Email Routing rule pointing at the Worker.
- An address named `*` catches everything not matched by another address.
- Sites whose domain can't receive through Cloudflare can forward mail to `<handle>+<address>@<NUXT_INBOUND_EMAIL_DOMAIN>`.
- AI sorts messages into lead, support, spam, or other with a one-line summary. Spam skips notifications and is deleted after 30 days.
- Editors reply from the admin, with an optional AI-drafted reply. Replies thread in the customer's mail app and their answers come back into the same conversation.
- Received HTML is shown in a sandboxed frame with remote images blocked until you choose to load them, and attachments always download. Messages that fail sender verification show a warning.

**Post by email**
- Authors get a private address under **My account**. Mail to it becomes a draft post, with images added to the media library. It's only accepted from the author's own address with a DKIM or DMARC pass, and the address can be replaced if it leaks.

**Alerts and notifications**
- Security alerts, always emailed: sign-in from a new device or country, password changed or reset, passkey added or removed, API key created, role changed.
- System alerts to admins: plugin installed, site status changed, full database export downloaded.
- Each person chooses email and push delivery per notification type under **My account**. Clicking a notification in the admin bell opens what it refers to.

**Email delivery**
- Every system email uses one branded template with a plain-text part, and sites can set a From name (defaults to the site name).
- Every send is logged. **Super Admin → Email** shows usage and failures per site, because Cloudflare's sending quota is shared by the whole account.
- Removed the MailChannels (`smtp`) provider. Choose Cloudflare, Resend, Brevo, or ZeptoMail.
- The Cloudflare provider notes now say correctly that until a domain is set up for sending, Cloudflare only delivers to verified addresses in your own account.

**Fixes**
- Background work (emails, push notifications, logging) is now kept alive after the response is sent. `waitUntil()` read a key Nitro never sets, so this work could be cut off in production.
- Deleting a site now also deletes its stored email from R2.
