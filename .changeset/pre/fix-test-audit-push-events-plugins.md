---
"@nuxflow/app": patch
---

fix: web push delivery, events visibility, plugin blocks, and smaller bugs found in a full test audit

**Web push**
- Push payloads can now be decrypted by browsers — the aes128gcm key and nonce derivation added the RFC 8291 counter byte twice, so no notification ever arrived.
- Chrome, Edge, and Android subscriptions are accepted again. The private-network check treated any hostname starting with `fc`/`fd`/`fe8`–`feb` as an IPv6 range, which rejected `fcm.googleapis.com` (and domains like `fdroid.org` on every other SSRF-checked route).
- Turning notifications off on one site no longer unsubscribes the same browser on your other sites.
- Push failures other than an expired subscription are now logged instead of silently dropped.

**Content visibility**
- `GET /api/public/events` and `/events.ics` no longer include private or members-only events, and the events API returns only the fields the calendar block renders (it previously returned each event's full body).
- The events list is ordered soonest first, so a limited list keeps the nearest events.

**Dynamic plugins**
- Plugin Canvas blocks render again: the iframe's Content-Security-Policy blocked its own inline bootstrap script. The script is now allowed by hash (no `unsafe-inline`), and values embedded in it can no longer close the `<script>` element.

**Other fixes**
- Stripe prices in zero-decimal currencies (JPY, KRW, …) and three-decimal currencies are sent in the correct unit instead of 100× the intended amount.
- The CSV content export quotes values correctly and neutralises spreadsheet formulas in titles.
- Paginated endpoints ignore a non-numeric or infinite `?page=` instead of passing `NaN` to SQL.
- Media folder names consisting only of spaces are rejected.
- AI translation returns 409 before calling the model when the translated slug is already taken, instead of a 500 afterwards.
- Removed the unreachable `seed-test-pages` development route.
