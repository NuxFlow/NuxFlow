# Email

NuxFlow uses Cloudflare's email products in both directions. **Email Sending** delivers password resets, invites, notifications, and inbox replies. **Email Routing** delivers mail sent *to* your site into NuxFlow, where it powers three features:

- **Inbox**: email to `contact@`, `leads@`, or any address you create lands in **Admin → Inbox**. There, AI sorts it into leads, support, or spam, and your team replies without leaving the admin.
- **Post by email**: each author gets a private address. Anything they send to it becomes a draft post, with attached images added to the media library.
- **Security and system alerts**: email when someone signs in from a new device, a password or passkey changes, an API key is created, a role changes, a plugin is installed, or a site's status changes.

This guide covers setup and how each feature behaves. For the sending-provider options, see [Email Providers](./installation.md#email-providers).

---

## What Cloudflare Email is for

Cloudflare Email Service is for **transactional** email only: messages triggered by something a person did or something that happened to their account. Its terms exclude marketing and bulk mail. Don't use the Cloudflare provider for newsletters or announcements to a list. NuxFlow's own features only send transactional mail.

Sending needs the Workers Paid plan, which NuxFlow already requires. Each Cloudflare account includes 3,000 emails a month, then $0.35 per 1,000. The quota and the daily sending limit belong to the **account**, so every site on your deployment shares them. New accounts start with a conservative daily limit that Cloudflare raises over time. **Admin → Super Admin → Email** shows how much each site sends and which sends failed.

Receiving through Email Routing is free and unlimited.

---

## Setting up receiving

NuxFlow manages addresses itself. You connect a domain to NuxFlow once. After that, you create and delete addresses in the admin with no DNS or Cloudflare changes.

### Option A: receive on your own domain

Use this when the domain is in the same Cloudflare account as your NuxFlow Worker and nothing else receives its mail yet.

1. In the Cloudflare dashboard, open the domain, then go to **Email → Email Routing** and enable it. Cloudflare adds the MX and SPF records it needs.
2. Under **Routing rules**, edit the **Catch-all address** rule. Set the action to **Send to a Worker**, choose your NuxFlow Worker, and enable the rule.
3. In NuxFlow, go to **Admin → Inbox → Addresses** and add an address, for example `contact`.

Email Routing takes over the domain's incoming mail. **If the domain already receives email through Google Workspace, Microsoft 365, Fastmail, or another host, don't enable it.** Use option B instead.

### Option B: forward from your existing mailbox

The platform operator can set up one shared receiving domain for every site, such as `in.example.com`:

1. Pick a domain or subdomain in the NuxFlow Cloudflare account that doesn't receive other mail, and set up Email Routing on it as in option A.
2. Set `NUXT_INBOUND_EMAIL_DOMAIN=in.example.com` on the Worker and redeploy.

Each site then gets a handle based on its domain (`acme.com` becomes `acme`). Every address also works as `acme+contact@in.example.com`, and `acme@in.example.com` reaches the site's catch-all address. To keep your normal mailbox and still get mail into NuxFlow, set up a forward in your existing provider to that address. **Admin → Inbox → Addresses** shows the exact address for each mailbox.

### Catch-all

An address named `*` receives everything sent to the domain that doesn't match another address. Without one, mail to an unknown address is ignored.

### Forwarding a copy

Each address can also forward every message to a normal mailbox. Cloudflare only forwards to **verified** destination addresses. Add the destination under **Email Routing → Destination addresses** in the Cloudflare dashboard, click the link in the confirmation email, then enter it on the address in NuxFlow.

---

## The inbox

**Admin → Inbox** is open to editors and admins. It lists received mail newest first, with **Unread**, **Archived**, and **Spam** views, search, and a category filter.

- **AI triage**: when an AI provider is configured (Workers AI works with no setup), each message gets a category (lead, support, or other) and a one-line summary. Spam goes straight to the Spam view without notifying anyone, and you can mark it **Not spam**.
- **Notifications**: new mail notifies every editor and admin in the app, by email, and by push. Turn off **Notify team** on an address to stop that, or have each person adjust it under **My account → Email and push notifications**.
- **Safe viewing**: HTML email is shown in a locked-down frame that can't run scripts or see your session. Remote images are blocked until you click **Load images**, because senders use them to track when a message is opened. Attachments always download instead of opening in the browser.
- **Sender warnings**: a message that failed the sender's own SPF, DKIM, or DMARC checks shows a warning that its From address may be forged.
- **Replying**: write a reply, or click **Draft with AI** to get a suggestion to edit. Nothing is sent until you click **Send reply**. Replies thread with the original in the customer's mail app, and their answer comes back into the same conversation.
- **Spam cleanup**: messages in Spam are deleted after 30 days, attachments included.

### Which address replies come from

If the mail arrived on your own domain, the reply goes out from the same address, so the conversation stays on `contact@acme.com`. With the Cloudflare provider, **sending must be enabled for that domain as well**, because routing and sending are enabled separately:

```bash
wrangler email sending enable acme.com
```

If the mail arrived through the platform domain (option B), the reply goes out from your site's normal From address, with Reply-To set back to the platform address. The customer's answer still reaches the inbox.

### Where messages are stored

Message details and text go in D1. The original message and its attachments go in your R2 bucket (`MEDIA_BUCKET`) under a private `_private/` prefix that the public media route never serves. Every key also ends in a random suffix, in case a public r2.dev or custom domain is attached to the bucket. Without an R2 bucket, messages are still received, but attachments can't be downloaded.

---

## Post by email

Authors, editors, and admins can turn this on under **My account → Post by email**. That creates a private address like `post-k7m2q…@acme.com`. Email sent to it becomes a **draft**:

- The subject is the title and the body is the content. Formatting from HTML email (bold, links, lists) is kept, and a `-- ` signature in plain-text mail is removed.
- Attached PNG, JPEG, GIF, and WebP images go into the media library. Images placed inside the email body stay where they were, and other attached images are added at the end. Remote images, such as tracking pixels and signature logos, are dropped.
- The post is saved as a draft of the blog post type and is never published automatically. You get an email with a link to review it.

A message only becomes a draft when all of these checks pass:

1. It was sent to your exact private address. The catch-all never accepts post-by-email mail.
2. It came from the email address on your NuxFlow account.
3. Your email provider signed it: it passes DKIM or DMARC. Gmail, Outlook, iCloud, and most providers do this automatically. This check exists because anyone can write a false From address.
4. You still have author access to the site.

Rejected messages leave a note in your in-app notifications but don't trigger an email, so a stranger who learns the address can't flood your mailbox. Each address accepts at most 20 messages an hour. If the address leaks, click **Replace address** and the old one stops working immediately.

---

## Security and system alerts

These go to the affected person by email and push, plus an in-app notification:

| Alert | When |
|---|---|
| New sign-in | A sign-in from a browser, operating system, or country the account hasn't used before. The very first sign-in only creates an in-app record. |
| Password changed | A password is changed, or reset with an emailed link. |
| Passkey added or removed | A passkey is registered or deleted. |
| API key created | Someone creates an API key for the account. |
| Role changed | The account's role on a site changes, including super admin grants. |

Security alerts **are always emailed**, whatever someone's notification preferences say, because their job is to reach the account owner when someone else might be in the account.

System alerts go to a site's admins:

| Alert | When |
|---|---|
| Plugin installed | A dynamic plugin is installed or updated. The admin who installed it isn't notified. |
| Site status changed | A super admin puts the site into maintenance, suspends it, or reactivates it. |
| Database exported | A full whole-platform export is downloaded. Other super admins are told. |

Everyone can choose email and push for the other notification types under **My account → Email and push notifications**.

---

## Troubleshooting

**Mail never arrives in the inbox.** Check that the domain's catch-all routing rule is enabled and set to *Send to a Worker* with your NuxFlow Worker. Check that the address exists and is switched on in **Admin → Inbox → Addresses**. Check that the site isn't suspended. `wrangler tail` shows any errors logged by `nuxflow:inbound-email`.

**Replies fail with "sender not verified".** Sending isn't enabled for that domain. Run `wrangler email sending enable <domain>`, or onboard the domain under **Email Service → Email Sending** in the dashboard.

**Password resets reach you but not other people.** Until a domain is onboarded for sending, Cloudflare only delivers to verified addresses in your own account. Onboard the domain your From address uses.

**Forwarded copies don't arrive.** The forwarding address must be a verified destination in Email Routing. Cloudflare doesn't send the copy otherwise.

**Post-by-email drafts don't appear.** Check your notifications for a "not accepted" note. It says whether the sender address didn't match, sender verification failed, or you hit the hourly limit.
