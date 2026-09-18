---
"@nuxflow/app": minor
"@nuxflow/db": minor
---

Add web push notifications (VAPID) for real-time in-app alerts.

**Server**
- `server/utils/webpush.ts`: full VAPID implementation using Web Crypto API (no Node.js dependencies) — key generation, subscription management, and RFC 8291 encrypted payload delivery.
- `server/api/v1/push/`: eight new endpoints: `vapid-public-key.get`, `vapid-keys.post` (generate/rotate keys), `subscribe.post`, `unsubscribe.delete`, `status.get`, `subscribers.get`, `broadcast.post`, `test.post`.
- `server/utils/notify.ts`: `sendNotification()` now broadcasts a web push alongside the in-app notification when the site has VAPID keys configured.
- `server/utils/settings.ts`: add `push.vapid_public_key` and `push.vapid_private_key` to `SENSITIVE_SETTING_KEYS` for encrypted-at-rest storage.
- Push triggers wired into `contact/submit.post.ts`, `content/[id].patch.ts`, and `memberships/webhooks/[provider].post.ts`.

**Frontend**
- `app/composables/usePushNotifications.ts`: composable that wraps the Push API, handles permission requests, subscribes/unsubscribes, and tracks state.
- `app/components/public/PushNotificationBanner.vue`: opt-in banner rendered on public pages.
- `app/layouts/default.vue`: mount the banner in the default layout.
- `app/pages/account.vue`: push notification toggle in the user account settings.
- `app/pages/admin/settings/index.vue`: VAPID key management and broadcast UI in Admin → Settings → Notifications.
- `public/sw.js`: service worker that handles `push` events and renders notifications via the Notifications API.

**Database**
- `packages/db/src/schema/system.ts`: new `push_subscriptions` table (`id`, `siteId`, `userId`, `endpoint`, `p256dh`, `auth`, `createdAt`).
- Migration `0001_simple_sprite.sql`: `CREATE TABLE push_subscriptions` applied automatically on next deploy.
