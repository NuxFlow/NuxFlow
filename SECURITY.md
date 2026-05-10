# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| Latest `main` | ✅ |
| Older releases | Bug fixes backported on a case-by-case basis |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Send a report to **[security@nuxflow.io](mailto:security@nuxflow.io)** with:

1. A clear description of the vulnerability
2. Steps to reproduce
3. Potential impact assessment
4. (Optional) A suggested fix or patch

You will receive an acknowledgement within **48 hours** and a full response within **7 days**.

Once the vulnerability is confirmed we will:

1. Coordinate a fix on a private branch
2. Prepare a release with a security advisory
3. Credit you in the advisory (unless you prefer anonymity)
4. Publish the fix, then disclose the vulnerability details

## Scope

Issues we consider in-scope:

- Authentication and session management flaws
- Cross-site scripting (XSS)
- SQL injection / query injection
- Cross-site request forgery (CSRF)
- Broken access control / privilege escalation
- Insecure direct object references
- Multi-site data leakage (a user accessing another site's data)
- Webhook signature bypass
- API key exposure

Out of scope:

- Issues requiring physical access to the server
- Denial-of-service attacks
- Rate limiting bypasses that require valid credentials
- Social engineering
- Issues in third-party dependencies (report directly to the dependency maintainer)
- Self-hosted deployments that have disabled recommended security settings

## Security Defaults

NuxFlow is designed secure by default:

- **Rate limiting** on auth and form submission endpoints (DB-backed, cross-isolate safe)
- **Cloudflare Turnstile** integration for public form spam protection
- **CSRF protection** via Better Auth
- **Webhook signatures** verified server-side (Stripe HMAC, Lemon Squeezy HMAC, Paddle Ed25519)
- **API keys** stored as SHA-256 hashes; the raw key is shown exactly once
- **Audit log** records all admin mutations
- **Multi-site isolation** enforced at the query level (every query scoped to `site_id`)
- **Role-based access control** enforced on every API route via `requireRole()`
- **Input validation** via Zod on all request bodies
- **Password hashing** via Better Auth (Argon2id)

## Dependency Updates

Security patches in dependencies are applied and released as quickly as possible. Subscribe to GitHub release notifications to stay informed.
