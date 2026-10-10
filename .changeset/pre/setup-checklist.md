---
"@nuxflow/app": minor
---

feat: "Finish setting up your site" checklist on the admin dashboard

- The dashboard now shows admins a live checklist of the settings every installation should have, since NuxFlow keeps working without them and the gaps aren't obvious. Essential: file storage, email sending, your own domain, a real auth secret, and search basics. Recommended: AI, bot protection, a passkey, a recent backup, and IndexNow.
- Each item explains what goes wrong without it and links to where it's fixed and to the matching step in the docs. Items tick themselves off once done.
- It also catches misconfigurations: a failing email provider, a missing email binding, Turnstile with only one of its two keys, a placeholder auth secret, or a site still hidden from search engines.
- Essential items can't be skipped. The card can be hidden once they're all done, and it comes back if one breaks later.
- Docs: new After-installation checklist in the installation guide. The Turnstile setup instructions were wrong and are fixed: the secret is `CLOUDFLARE_TURNSTILE_SECRET_KEY` and the site key goes in Settings → Integrations. The cron trigger description is updated.
