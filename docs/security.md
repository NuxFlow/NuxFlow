# Security

This page documents the specific algorithms, libraries, and design decisions NuxFlow uses to protect user data and resist common attack classes. The intent is transparency: security that cannot be examined cannot be trusted.

---

## Password Hashing

NuxFlow uses **Argon2id** — the winner of the Password Hashing Competition (2015) and the OWASP 2024 **first-choice** recommendation for new systems.

### Parameters

| Parameter | Value | What it means |
|---|---|---|
| Algorithm | Argon2id | Combines data-dependent (Argon2d) and data-independent (Argon2i) memory access, resisting both GPU brute-force and side-channel attacks |
| Memory cost | 19,456 KiB (~19 MiB) | An attacker cracking a stolen database needs ~19 MB of RAM *per guess* — makes large GPU farms and ASICs economically impractical |
| Time cost | 2 iterations | Two passes over the memory block |
| Parallelism | 1 thread | Single-threaded; tuned for edge runtime constraints |
| Output | 256 bits (32 bytes) | PHC-encoded string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` |
| Salt | 128-bit random per hash | `crypto.getRandomValues()` — unique per password, prevents rainbow table attacks |

These parameters exceed OWASP's minimum recommendation (m=19456 KiB, t=2, p=1) and are calibrated against NIST SP 800-63B guidance.

### Why a Separate Worker?

Cloudflare Workers' WebAssembly runtime blocks `WebAssembly.compile()` on dynamic byte arrays at request time — only statically imported `.wasm` modules pre-compiled at bundle time by Wrangler are permitted. This prevents the common pattern of downloading or generating Wasm at runtime.

NuxFlow solves this with a dedicated `nuxflow-argon2` Cloudflare Worker that:
1. Imports `argon2.wasm` statically at build time (pre-compiled by Wrangler into a `WebAssembly.Module`)
2. Instantiates the module on the first request within each Worker isolate and caches it for the lifetime of the isolate
3. Exposes `hash()` and `verify()` methods via Cloudflare **service binding RPC** — a zero-network-cost private channel between two Workers on the same account

The Wasm binary (`argon2.wasm`) comes from the [`argon2-browser`](https://github.com/nicktacular/argon2-browser) npm package, which wraps the [official argon2 reference implementation](https://github.com/P-H-C/phc-winner-argon2) compiled via Emscripten. The source is fully open and auditable; any deployer can rebuild the binary and verify it matches the shipped file.

### Fallback (Free Plan / Local Development)

When the `ARGON2` service binding is unavailable — either because the deployer is on the Cloudflare Workers Free plan (which does not support service bindings) or during local `pnpm dev` — NuxFlow automatically falls back to **scrypt** via `node:crypto`:

| Parameter | Value |
|---|---|
| N (CPU/memory cost) | 16,384 |
| r (block size) | 16 |
| p (parallelism) | 1 |
| Output | 512 bits (64 bytes) |

scrypt is OWASP's second-choice recommendation and remains a strong algorithm. The fallback is transparent — no configuration is required and the stored hash format (`saltHex:keyHex`) is automatically detected at verify time.

> [!WARNING]
> **Production Argon2id Hash Portability in Local Dev:**
> Because the `ARGON2` service binding is unavailable in standard local development (`pnpm dev`), the dev server has no way to verify Argon2id hashes. If you import a production database dump locally, any attempt to log in using those production credentials will fail (verifying the `$argon2` hash returns `false`).
> 
> **Workaround:** To log in locally with an imported production database, you must manually reset your local admin user's password field. This can be done by running a database seed script, using a SQLite shell to replace the `password` field with an `scrypt` hash, or re-running the setup wizard.


---

## Session Management

Sessions are handled by [Better Auth](https://www.better-auth.com/) v1.6.x via the `@onmax/nuxt-better-auth` Nuxt module.

- Sessions are stored in the database (`sessions` table) and referenced by an opaque token in a `HttpOnly; Secure; SameSite=Lax` cookie — the token is never readable by JavaScript running on the page
- Session tokens are generated with `crypto.getRandomValues()` — cryptographically random
- Sessions expire and are rotated on activity; the rotation window is configurable
- OAuth sessions (Google, GitHub) follow the same session model — the provider token is stored in the `accounts` table but is not exposed to the frontend

---

## Sensitive Settings Encryption

API keys, SMTP passwords, payment provider secrets, and other sensitive settings stored in the `site_settings` table are encrypted at rest using **AES-256-GCM** before writing to D1.

- The encryption key is derived from `NUXT_BETTER_AUTH_SECRET` using the Web Crypto API (`globalThis.crypto.subtle`)
- Each encrypted value includes a unique 96-bit IV and a 128-bit authentication tag — tampering with the ciphertext causes decryption to fail rather than returning corrupt plaintext
- Decryption happens server-side only at the moment the value is needed; the plaintext is never cached or logged
- Keys listed in `SENSITIVE_SETTING_KEYS` are encrypted automatically by `resolveSetting()` / `saveSetting()` — there is no per-caller opt-in

---

## Plugin Security

Third-party dynamic plugins run as isolated Cloudflare Worker instances. The security model has two layers:

### Code Signing (Ed25519)

Every plugin bundle must be signed with the author's Ed25519 private key before it can be installed. NuxFlow verifies the signature:
- **On install** — the server rejects the bundle if the signature does not match the author's registered public key or if any SHA-256 checksum is wrong
- **On every request** — the signature and checksums are re-verified each time the plugin Worker is spawned from KV, preventing silent tampering after installation

Authors generate their keypair with `nuxflow plugin keygen`. The private key never leaves the author's machine. Only the public key is embedded in `nuxflow.plugin.json` and registered on the site at install time.

### Isolate Sandboxing

Each plugin runs inside its own Cloudflare Worker isolate, spawned via the Dynamic Workers API (`WorkerLoader`). Isolates share no memory with the main NuxFlow Worker or with each other. A misbehaving plugin cannot read the main app's memory, environment variables, or database connection.

---

## Input Validation

All API endpoints validate request bodies and query parameters against **Zod** schemas before touching any business logic. Validation failures return structured 422 responses. There is no hand-written string parsing of user input.

Database queries use **Drizzle ORM** with parameterized statements throughout — there is no string concatenation of SQL. D1's prepared statement API enforces parameterization at the protocol level.

---

## SSRF and Archive Safety

Two utility functions in `server/utils/security.ts` protect endpoints that fetch external URLs or process uploaded archives:

**`isSafeUrl(url)`** — blocks Server-Side Request Forgery by refusing URLs that resolve to:
- Private IPv4 ranges (`10.x`, `172.16–31.x`, `192.168.x`)
- Loopback addresses (`127.x`, `::1`)
- Link-local addresses (`169.254.x`, `fe80::`)
- Reserved hostnames (`localhost`, `.local`, `.internal`)
- Non-HTTP(S) schemes (`file://`, `ftp://`, etc.)

**`validateZipArchive(data, maxUncompressedSize)`** — inspects the ZIP central directory without decompressing and rejects:
- **Zip Slip** attacks — any entry whose path contains `..` or an absolute path
- **Zip Bombs** — archives whose total uncompressed size exceeds the configured limit (returns HTTP 413)

Both functions are called by the plugin installer, theme importer, and any other handler that processes external content.

---

## Rate Limiting

`rateLimit(event, opts)` in `server/utils/rate-limit.ts` enforces request limits with a two-tier strategy:

1. **Isolate-level memory cache** — checked first, no database round-trip; eliminates most burst traffic instantly
2. **D1 database upsert** — atomic counter shared across all Cloudflare Worker isolates (including across data centres under the same D1 global replica)

Auth endpoints (`/api/auth/sign-in`, `/api/auth/sign-up`, password reset) apply rate limits by IP address and email address independently, making credential-stuffing attacks significantly more expensive.

---

## API Authentication

NuxFlow supports two authentication methods for server API access:

**Session cookies** — the default for browser clients; `HttpOnly; Secure` cookie set by Better Auth.

**API keys** — named bearer tokens for headless or external access. Keys are stored as salted hashes (not plaintext) in the `api_keys` table. On each request the `Authorization: Bearer <key>` header is verified by `server/middleware/03.api-key-auth.ts`, which sets `event.context.apiKeyUserId` and `event.context.apiKeyRole` for downstream handlers. Keys can be revoked instantly from the admin dashboard.

---

## Cloudflare Edge Isolation

NuxFlow runs on Cloudflare Workers, which provides several security properties at the infrastructure level that would require significant effort to replicate on a traditional server:

- **V8 isolates per request** — each Worker invocation runs in a fresh V8 isolate. There is no shared process memory between concurrent requests or between different tenants on a multi-site installation.
- **No filesystem access** — Workers have no access to a filesystem; there is no path for file-based attacks.
- **Automatic TLS** — all traffic is TLS-terminated at Cloudflare's edge; there is no plaintext HTTP path in production.
- **DDoS mitigation** — Cloudflare's network-layer DDoS protection is active by default on all Workers routes at no additional cost.
- **Secret isolation** — Wrangler secrets (environment variables) are encrypted at rest by Cloudflare and are not accessible via the Workers dashboard or API after being set; they are only decrypted inside the isolate at runtime.

---

## Responsible Disclosure

If you discover a security vulnerability in NuxFlow, please **do not open a public GitHub issue**. Email the details privately to the maintainers as described in [SECURITY.md](../SECURITY.md). We aim to acknowledge reports within 48 hours and coordinate a fix and disclosure timeline with the reporter.
