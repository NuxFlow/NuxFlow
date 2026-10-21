# NuxFlow Roadmap & Future Features

This document tracks planned features and the preparatory groundwork already in place for them. It exists so that the reasoning behind certain schema or API decisions is not lost over time — some things were added early specifically to make a future feature easier.

---

## Visitor analytics: what's next

Admin → Analytics (page views per day, top pages, referrers, countries and devices, on Cloudflare Analytics Engine — see `server/utils/analytics.ts` and the user guide's **Analytics** section) is built. Left for later:

- **History beyond 3 months.** Analytics Engine keeps 90 days. A nightly task could copy each site's daily totals into D1, the way `site_usage_daily` works, for year-on-year charts.
- **An estimate of visitors**, not just page views. Without cookies this has to be a daily-rotating hash of IP + user agent (the Plausible/Fathom method), which is approximate and needs a short privacy note.
- **Events beyond page views**: form submissions, paywall encounters, and memberships bought — each is one more `writeDataPoint()` with its own first blob, and shows which pages earn money rather than only which get visits.
- **Leaving out the site's own team**, whose visits are counted today.

---

## Browser Rendering for dynamic OG/social cards

**What**: Use the `@cloudflare/puppeteer` binding to screenshot a public page or Canvas layout at the edge and save the PNG to the active media provider, for automatic social-share images instead of relying on a manually-set `ogImage`.

**Why valuable**: Every public page already has `seoTitle`/`ogImage` fields, but most content never gets a manually-designed share image. A generated card (title + site branding rendered over a template) is a meaningful default-quality improvement with no editor effort.

**What still needs to be built**: a `BROWSER` binding declaration, a render route that takes a content item's title/excerpt and produces a templated screenshot, a cache layer (these shouldn't regenerate on every request — generated when an item is published, alongside the IndexNow ping and plugin hooks), and a fallback to the existing manual `ogImage` field when set.

---

## AI feature UI follow-ups

Small, well-scoped items left over from the Sept 2026 Cloudflare AI integration pass (Workers AI, AI Gateway, Vectorize/semantic search, AI page & site generation, and a batch of smaller AI features — all shipped; see CLAUDE.md's "AI providers"/"Multilingual content"/"Events system" sections for the technical reference and `docs/user-guide.md`'s "AI Features" section for the user-facing summary). What's still open:

- **Stock / AI-generated images for AI-generated pages** — page generation now uses images already in the site's media library (when there are any); a page on a fresh site still gets no imagery. Suggesting stock photos, or generating images for the page, is the follow-up.
- **Full RAG grounding for AI page/site generation** — `generate-content.post.ts` (prose generation) already grounds its output in the site's existing content via semantic search; the block-based generator (`generateCanvasPage()` in `canvas-generation.ts`) doesn't yet do the same.

---

## [DEFERRED] Isolated App/Server TypeScript Type-Checking

### Status: Blocked on upstream Nuxt bugs — revisit on Nuxt upgrade

Unlike the feature work above, this is internal tooling debt, not a product feature — tracked here so the reasoning and exit condition aren't lost.

### The situation

`pnpm typecheck` currently type-checks the Vue app (`app/**`) and the Nitro server (`server/**`) as **one shared program** rather than two isolated ones. Nuxt generates separate sub-configs (`.nuxt/tsconfig.server.json` with `webworker` lib, no `dom`) that look like they'd isolate the two, but the root `apps/nuxflow/tsconfig.json` doesn't reference them, so `nuxt typecheck` never actually runs them as a proper composite build — it falls back to a single unified `vue-tsc --noEmit` pass, and server files end up pulled into the same program as app files via Nuxt's typed-`$fetch` route inference.

Practical effect: Cloudflare Workers runtime types (`apps/nuxflow/worker-configuration.d.ts`, added for the security audit's plugin-sandboxing work) are visible from browser-side Vue code too, and vice versa. Mostly harmless, but real — e.g. `Response.json()` returns `Promise<unknown>` (workerd's stricter typing) instead of `Promise<any>` (DOM's) even inside `.vue` components, because both are in the same program. Confirmed empirically, not theoretical — see `apps/nuxflow/tsconfig.json` and the "Cloudflare-specific utilities" section of `CLAUDE.md` for the full account.

### Why not fixed now

Nuxt's own docs confirm the unified pattern is legacy and will be replaced by TypeScript project references (`references: [...]` in the root tsconfig) — that's the correct target architecture, not a workaround. But turning it on (last checked on Nuxt 4.4.x; the project is now on 4.6 and hasn't been re-tested) hits multiple open upstream bugs:

- [nuxt/cli#1224](https://github.com/nuxt/cli/issues/1224) — `-b` build mode fails to resolve `declare global` auto-imports
- [nuxt/nuxt#34212](https://github.com/nuxt/nuxt/issues/34212) — typecheck errors on auto-imported Vue/Nuxt utils
- [nuxt/nuxt#35319](https://github.com/nuxt/nuxt/issues/35319) — crash combining `tsconfig.server.json` with certain SSR/typecheck settings

Switching now would trade one small, already-fixed type gap for currently-broken tooling. Not worth it pre-release.

### What to do when ready

This is a mechanical flip, not a redesign, once Nuxt fixes the issues above (or a Nuxt upgrade sidesteps them):

1. Add `"references": [{ "path": "./.nuxt/tsconfig.server.json" }]` (plus any other generated sub-configs worth isolating) to `apps/nuxflow/tsconfig.json`.
2. Run `pnpm typecheck` — this makes `nuxt typecheck` switch to `vue-tsc -b --noEmit` (composite build mode) automatically.
3. Confirm auto-imports (`ref`, `useState`, etc.) still resolve and nothing crashes.
4. If clean: remove the `REVISIT` comment block from `tsconfig.json`, and confirm `worker-configuration.d.ts` is only visible from server-side files (move it under `server/types/` if the isolated server tsconfig's `include` picks it up there instead of needing the project-root location the unified setup required).

No urgency to monitor actively — check when bumping Nuxt to a new major/minor, or if the linked issues show as closed.

---

## Mailing list: what's next

The mailing list (Admin → Mailing list) collects email addresses through the signup popup and the Signup box block, with double opt-in, unsubscribe links, CSV export and optional copying to a Brevo list. Not built yet:

- **Sending newsletters from NuxFlow.** This would go through the site's own third-party provider only (Resend, Brevo or ZeptoMail), never Cloudflare Email Sending, whose terms allow transactional mail only. Each email needs the `List-Unsubscribe` / `List-Unsubscribe-Post` headers. The one-click endpoint already exists (`POST /api/public/mailing-list/unsubscribe?id=&token=`, see `oneClickUnsubscribeUrl()` in `server/utils/mailing-list.ts`).
- **Phone number capture and SMS marketing.** Left out of the first version. Marketing texts need their own explicit consent (US TCPA, UK PECR), stored separately from email consent, and an SMS provider. It would share its provider work with **SMS Notifications** below.
- **Mailchimp sync**, alongside the existing Brevo sync.
- **Subscribers in the per-site backup.** Today the signup settings are backed up but the list itself isn't; moving a site means exporting the CSV.
- **Several popups** (different offers per section of the site) and A/B testing of headings.

---

## Push notifications: what's next

Browser push works end to end (Settings → Push, My account, `server/utils/webpush.ts`). Left open after the October 2026 audit:

- **Large broadcasts.** A broadcast sends to every subscriber inside one Worker invocation, which is fine for hundreds of subscribers but will hit Cloudflare's per-invocation limits in the thousands. The fix is to put each batch on a Cloudflare Queue.
- **Readers who aren't signed in.** Subscribing needs a site login today, so "New content published" only reaches members and the team. Letting anonymous visitors subscribe needs a subscription row without a user, its own unsubscribe path, and the same abuse limits subscribing has now.
- **iPhone/iPad.** iOS only allows push for a site added to the home screen, which needs a web app manifest (name, icons, theme colour — a per-site `manifest.webmanifest` route would do). No offline mode or install prompt needed for this.

---

## SMS Notifications

### Vision

Site owners and their users should be able to receive notifications via SMS in addition to email and browser push. Use cases include transactional alerts (new form submission, payment confirmation, membership expiry), admin digests, and member-facing notifications for time-sensitive content like events.

SMS is deliberately opt-in per user — no one receives a text message unless they have both provided a phone number and toggled SMS notifications on. Site owners choose one provider and configure it once in Admin → Settings → SMS, in the same way email is configured today.

### Why this is valuable

- **Higher open rates**: SMS open rates are typically 90%+ vs. 20–30% for email. For genuinely urgent notifications (event reminders, payment failures), SMS meaningfully increases the chance the user acts in time.
- **No extra infrastructure**: The notification system already fans out to email and browser push via `sendNotification()` in `server/utils/notify.ts`. SMS is a fourth flag on the same call — no new job queue, no new table, no new scheduled task.
- **Some providers are already half-integrated**: Brevo (already supported for email) offers a transactional SMS API on the same API key. Sites already using Brevo for email can enable SMS with zero additional credentials.
- **Edge-compatible**: All four target providers expose plain REST APIs with JSON bodies. No Node.js SDK required — pure `fetch()` calls, identical to how Resend/Brevo/ZeptoMail are implemented today.

### Provider comparison

| Provider           | Also does email?        | Auth                                   | Notes                                                                            |
| ------------------ | ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| **Twilio**         | Via SendGrid (separate) | Account SID + Auth Token + from number | Industry standard, widest global reach, MMS support, most Stack Overflow answers |
| **Vonage (Nexmo)** | Yes (Email API)         | API Key + API Secret + from            | Strong EU coverage, competitive pricing, unified comms platform                  |
| **Brevo**          | ✅ Already integrated   | Same API key as email                  | Lowest-friction option for sites already on Brevo — no new credentials required  |
| **Telnyx**         | No                      | Single API key                         | Developer-friendly REST API, competitive pricing, good documentation             |

Recommended default order: **Brevo** (if already configured) → **Twilio** → **Vonage** → **Telnyx**.

### Groundwork already in place

#### `phone` column on `users`

(Present since `packages/db/migrations/0000_initial.sql` — earlier revisions of this doc cited migration `0008`, which is stale after a schema-history squash.)

A nullable `phone` text column was added to the `users` table proactively. It stores the user's phone number in E.164 format (e.g. `+447700900123`). Because it is nullable with no unique constraint, it has zero impact on existing users and zero risk of breaking the auth flow (Better Auth does not touch this column).

This column is the only place phone numbers live. There is deliberately no `sms_subscriptions` table — the `push_subscriptions` table pattern (one row per device per user) is not needed for SMS since phone numbers are already globally unique per person.

#### `SENSITIVE_SETTING_KEYS` pre-populated (`settings.ts`)

The following keys were added to `SENSITIVE_SETTING_KEYS` now so that any SMS credential stored in `site_settings` is automatically AES-GCM encrypted at rest from the moment the feature lands:

- `sms.twilio_auth_token`
- `sms.vonage_api_secret`
- `sms.brevo_api_key` _(shared with email if Brevo is the email provider)_
- `sms.telnyx_api_key`

#### Notification fanout architecture (`notify.ts`)

`sendNotification()` already accepts per-call flags to opt into email (`sendEmailNotification`) and push (`sendPush`). Adding `sendSms` follows the identical pattern — look up `users.phone`, call `sendSms(event, msg)`, catch and log errors without throwing. No callers need to change unless they want to opt into SMS for a specific notification type.

### What still needs to be built

#### 1. `server/utils/sms.ts` — provider dispatcher

Mirrors `email.ts` exactly:

```typescript
interface SmsMessage {
  to: string // E.164 format, e.g. +447700900123
  body: string // Plain text only — no HTML
}

interface SmsConfig {
  smsProvider: string // 'twilio' | 'vonage' | 'brevo' | 'telnyx' | 'console'
  twilio?: { accountSid: string; authToken: string; from: string }
  vonage?: { apiKey: string; apiSecret: string; from: string }
  brevo?: { apiKey: string; from: string }
  telnyx?: { apiKey: string; from: string }
}

export async function sendSms(event: H3Event, msg: SmsMessage): Promise<void>
```

Provider-specific implementation notes:

- **Twilio**: `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` with Basic auth (`AccountSID:AuthToken`), `application/x-www-form-urlencoded` body
- **Vonage**: `POST https://rest.nexmo.com/sms/json` with JSON body containing `api_key`, `api_secret`, `from`, `to`, `text`
- **Brevo**: `POST https://api.brevo.com/v3/transactionalSMS/sms` — same `api-key` header as the email integration, body has `sender`, `recipient`, `content`
- **Telnyx**: `POST https://api.telnyx.com/v2/messages` with `Authorization: Bearer {apiKey}`, JSON body

#### 2. `sendSms` flag on `sendNotification()` in `notify.ts`

```typescript
interface NotifyOptions {
  // ... existing fields ...
  sendSms?: boolean // Also send an SMS to the user's phone number if set
}
```

In the body: look up `users.phone`, skip silently if null, call `sendSms()`, catch and log errors without re-throwing (same pattern as `sendEmailNotification`).

#### 3. Settings keys for `loadSmsConfig()`

Settings to read via `resolveSetting()`:

| Key                      | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `sms.provider`           | Active provider: `twilio`, `vonage`, `brevo`, `telnyx`, `console` |
| `sms.twilio_account_sid` | Twilio Account SID (not sensitive — public identifier)            |
| `sms.twilio_auth_token`  | Twilio Auth Token (**encrypted**)                                 |
| `sms.twilio_from`        | Twilio sender number or alphanumeric ID                           |
| `sms.vonage_api_key`     | Vonage API Key                                                    |
| `sms.vonage_api_secret`  | Vonage API Secret (**encrypted**)                                 |
| `sms.vonage_from`        | Vonage sender name/number                                         |
| `sms.brevo_api_key`      | Brevo API Key (**encrypted**, shared with email if same provider) |
| `sms.brevo_from`         | Brevo sender name (alphanumeric, max 11 chars)                    |
| `sms.telnyx_api_key`     | Telnyx API Key (**encrypted**)                                    |
| `sms.telnyx_from`        | Telnyx sender number                                              |

#### 4. Admin UI — Settings → SMS tab

A new "SMS" tab in `app/pages/admin/settings/index.vue`, matching the layout of the existing Email tab:

- Provider selector dropdown (Console / Twilio / Vonage / Brevo / Telnyx)
- Conditional credential fields per provider (same show/hide pattern as email)
- "Send test SMS" button — posts to a new `/api/v1/settings/sms-test` endpoint that sends a real SMS to the admin's own phone number (requires `users.phone` to be set on their account)
- Save / mask behaviour identical to email (sensitive fields masked after save with `SECRET_MASK`)

#### 5. User profile — phone number field

The account page (**My account**, `/account`) needs a phone number input field:

- Validates E.164 format client-side before saving
- Saves via `PATCH /api/v1/users/me` (extend that route to accept `phone`)
- Separate from notification preferences — having a phone number stored does not automatically opt the user in to SMS

#### 6. SMS opt-in preference per user

The per-user, per-type preference table now exists: `notification_preferences` (`userId`, `siteId`, `type`, with `email` and `push` booleans), shown as the Email/Push switches under **My account → Email and push notifications** and read by `channelPrefs()` in `notify.ts`. SMS opt-in is an `sms` column on that table (default **off**, unlike email/push), a third switch column in `AccountNotificationPreferences`, and a third channel in `channelPrefs()`. The flag in `sendNotification` stays intent only — the send also checks this preference and that `users.phone` is set.

#### 7. `/api/v1/settings/sms-test` endpoint

Mirrors `/api/v1/settings/email-test`. Loads SMS config via `loadSmsConfig()`, sends a fixed test message to the requesting user's `phone`, returns `{ ok: true }` or a descriptive error.

### What was explicitly ruled out

- **OTP / 2FA via SMS**: Better Auth handles multi-factor authentication. Integrating SMS-OTP into the auth flow requires hooking into Better Auth's plugin system specifically (it supports a `twoFactor` plugin). This is a distinct task from the transactional SMS feature above and should be tracked separately when 2FA is prioritised.
- **Bulk SMS / marketing campaigns (in this feature)**: Transactional SMS (one notification triggered by a real event) is the use case here. Marketing texts are planned for later, as part of the mailing list (see **Mailing list: what's next**), not soon — they need their own consent record (US TCPA, UK PECR), opt-out handling and carrier reputation management, a separate scope. They would reuse this feature's provider code.
- **Per-message cost visibility**: Carrier costs vary by country and provider. Surfacing per-message pricing in the admin is not worth the complexity; site owners should check their provider dashboard.
- **SMS as an auth channel (passwordless login)**: Similar to OTP/2FA — belongs in the auth layer, not the notification layer.

### Suggested implementation order

1. `server/utils/sms.ts` with Brevo support first (easiest, no new credentials for existing Brevo users)
2. `sendSms` flag on `sendNotification()` in `notify.ts`
3. Phone number field on user profile + `PATCH /api/v1/users/me` extension
4. Admin Settings → SMS tab + test endpoint
5. Add Twilio support (highest user demand)
6. Add Vonage and Telnyx support
7. User SMS opt-in preference

Steps 1–3 can be done in a single sitting. Steps 4–7 are polish and breadth.

---
