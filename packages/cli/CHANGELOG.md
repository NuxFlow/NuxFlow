# @nuxflow/cli

## 1.0.0-beta.1

### Minor Changes

- 45f9a6d: feat: the CLI deploys with an API key, so it works on multi-site installs
  
  **Breaking for the CLI:** `nuxflow plugin deploy`/`update` and `nuxflow theme deploy`/`update` no longer take `--email` and `--password`. Use an API key instead:
  
  1. In your site's admin, go to **Settings → API keys** and create a key with **Install and remove plugins** and/or **Upload and update themes**.
  2. Set `NUXFLOW_SITE` and `NUXFLOW_API_KEY` (or pass `--site` and `--api-key`).
  
  Signing in with a password only ever worked on single-site installs: with central sign-in, passwords are accepted only on the accounts domain, so the CLI got "not found" on every site domain.
  
  - Two new API key permissions, `manage:plugins` and `manage:themes`. A key with one of them works only while the person who created it is still an admin of that site.
  - The CLI never handles your password, and still refuses to send its key over plain `http://` (except to `localhost`).

### Patch Changes

- 2a6b34c: `nuxflow --version` and the help header now show the real package version instead of a hard-coded `0.1.0`.
