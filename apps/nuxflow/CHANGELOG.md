# @nuxflow/app

## 1.0.0

### Minor Changes

- Added state-of-the-art passwordless Passkeys (WebAuthn) biometric authentication, fully integrated a secure media-ingesting WordPress WXR Importer with Edge media upload and SSRF protection, added a native edge-compatible Model Context Protocol (MCP) server for AI agent content management, and resolved client-side authentication composable regressions.

### Patch Changes

- 4133bc3: Resolved Nitro router sibling dynamic conflicts by restructuring dynamic form endpoints under a unified `[formIdentifier]` directory. Fixed import page visibility contrast issues in light mode, integrated global `<UNotifications />` in app.vue, and added a fully comprehensive administrative E2E playwright test suite.
- 4133bc3: Resolved layout bugs in the Canvas testimonial blockquote by suppressing default browser quotes and optimizing z-index layering. Added a high-contrast dark space glassmorphic features card theme and a responsive 2-column open-source quick-start grid on the homepage.
- 4133bc3: Added site settings resolver server plugin to automatically resolve and cache site configuration at boot, updated settings and themes administrative panels, and refined styling assets for responsive alignment.
- Updated dependencies [4133bc3]
- Updated dependencies
  - @nuxflow/plugin-canvas@1.0.0
  - @nuxflow/db@1.0.0
  - @nuxflow/plugin-html-block@1.0.0
  - @nuxflow/plugin-sdk@1.0.0
  - @nuxflow/plugin-payments@1.0.0
  - @nuxflow/plugin-contact-form@1.0.0
