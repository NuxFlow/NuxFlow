# create-nuxflow-app

## 1.0.0-beta.1

### Minor Changes

- 45f9a6d: fix: release-readiness pass — security headers, primary-site protection, pinned scaffolder
  
  **Security**
  - Admin, account, setup, and sign-in pages can no longer be framed by other sites (clickjacking protection). Every response also sends `X-Content-Type-Options: nosniff` and a `Referrer-Policy`.
  - Google and GitHub sign-in tokens are now encrypted in the database.
  - Video upload requests are validated; a malformed Cloudflare Stream ID is rejected.
  - Security reports now go through GitHub's private vulnerability reporting (the old contact address didn't exist).
  
  **Fixes**
  - The primary site can no longer be deleted while other sites exist, from either Settings → Danger Zone or Super Admin → Sites. "Primary" now means the site flagged as primary, not the oldest one.
  - `/api/health` reports the real version.
  - The Themes page no longer describes "bundled themes" installed with a command that doesn't exist, and the image generator no longer claims it needs a DALL-E or Imagen key.
  
  **Changes**
  - `create-nuxflow-app` now downloads the NuxFlow release it was published with, instead of whatever is on `main`. Set `NUXFLOW_TEMPLATE_REF` to scaffold from a branch or commit instead.
  - Old compatibility paths were removed: settings encrypted with the pre-HKDF key, theme CSS stored under the unversioned KV key, `post_tag` in backups, and DALL-E pixel sizes on the image API.
