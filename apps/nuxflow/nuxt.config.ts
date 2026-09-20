import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const _dirname = fileURLToPath(new URL('.', import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-08-27',

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  modules: [
    '@nuxt/ui',
    '@nuxtjs/i18n',
    '@nuxtjs/turnstile',
    '@pinia/nuxt',
    'nuxt-seo-utils',
  ],

  ssr: true,

  nitro: {
    // Local dev runs exclusively through `wrangler dev` (see apps/nuxflow/package.json),
    // which always performs a production-mode build — so this preset applies uniformly,
    // unlike the old NODE_ENV-conditional split that existed when `nuxt dev` was also
    // a supported dev path.
    preset: 'cloudflare-module',
    experimental: {
      wasm: true,
      tasks: true,
    },
    rollupConfig: {
      output: {
        intro: 'import "reflect-metadata";',
      },
    },
    // @better-auth/core ships optional OpenTelemetry instrumentation that imports
    // @opentelemetry/api. That package is not installed and Cloudflare Pages preset
    // forbids externals, so we stub it out here.
    alias: {
      '@opentelemetry/api': resolve(_dirname, 'server/stubs/opentelemetry-api.mjs'),
    },
    scheduledTasks: {
      // publish-scheduled runs every minute; demo-reset seeds an empty DB on first boot.
      // demo-reset and demo-nightly-reset guard themselves via isDemoInstance() so they
      // are safe to include unconditionally — NUXT_IS_DEMO is a runtime [vars] entry in
      // wrangler.demo.toml and is NOT available as process.env during the build step.
      '* * * * *': ['publish-scheduled', 'demo-reset'],
      // Nightly at 3 AM UTC — prune old data; demo instances also wipe and reseed.
      '0 3 * * *': ['prune-old-data', 'demo-nightly-reset'],
      // Hourly — sweep video_assets rows stuck at status:'processing' (a failed/never-
      // completed Cloudflare Stream upload) past a 2-hour TTL and mark them 'failed'.
      '0 * * * *': ['reconcile-stuck-videos'],
    },
    serverAssets: [
      { baseName: 'migrations', dir: resolve(_dirname, '../../packages/db/migrations') },
      // Vue runtime build served to the sandboxed plugin iframe (see
      // server/routes/_nuxflow/vendor/vue-runtime.js.get.ts) — checked in rather than
      // read from node_modules at request time, since Cloudflare Workers has no
      // filesystem access at runtime. Regenerate after bumping the `vue` dependency:
      //   cp node_modules/vue/dist/vue.runtime.esm-browser.prod.js server/assets/vendor/vue-runtime.js
      { baseName: 'vendor', dir: resolve(_dirname, 'server/assets/vendor') },
    ],
  },

  ui: {
    // Restores Nuxt UI's built-in semantic slots (secondary/success/info/warning/error),
    // which a prior literal-color-name list here had silently dropped project-wide —
    // only 'primary'/'neutral' are structurally required and survive an override.
    // 'orange' has no semantic equivalent, so it stays registered as a genuine custom color.
    theme: {
      colors: ['secondary', 'success', 'info', 'warning', 'error', 'orange'],
    },
  },

  // Store color-mode preference in a cookie so SSR renders the correct theme,
  // preventing the dark/light hydration mismatch on initial page load.
  colorMode: {
    preference: 'system',
    fallback: 'light',
    storageKey: 'nuxt-color-mode',
  },

  i18n: {
    // The `v-t` directive isn't used anywhere in this app (only the `$t()`/`useI18n()`
    // composable API is), so this build-time optimization has nothing to do — explicitly
    // disabling it (rather than leaving the default `true`) silences a warning the module
    // itself recommends addressing ahead of its v10 deprecation, with no behaviour change.
    bundle: { optimizeTranslationDirective: false },
    defaultLocale: 'en',
    // .ts, not .json — see the comment in app/locales/en.ts for why.
    locales: [{ code: 'en', file: 'en.ts', name: 'English' }],
    // restructureDir: false keeps @nuxtjs/i18n v9's newer default project layout (a
    // top-level i18n/locales/ directory) opted out of, so a relative `langDir` resolves
    // against srcDir (app/) instead — matching where this project actually keeps
    // app/locales/. Without this, a relative langDir resolves against `<rootDir>/i18n/`
    // by default, and the module looked for a nonexistent apps/nuxflow/i18n/locales/en.ts.
    // langDir must be relative, not absolute: @nuxtjs/i18n warns that an absolute path
    // "will not work in production", and Nuxt 4.5's Vite 8/Rolldown bundler makes that
    // literal — an absolute Windows path fed into i18n's lazy-loaded locale import broke
    // the production build outright, where Vite 7's esbuild-based pipeline had silently
    // tolerated the same misconfiguration.
    restructureDir: false,
    langDir: 'locales',
    strategy: 'no_prefix',
  },

  runtimeConfig: {
    betterAuthSecret: '',
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    cloudflareImagesToken: '',
    cloudflareAccountId: '',
    cloudflareStreamToken: '',
    cloudflareImagesDeliveryUrl: '',
    // Cloudflare R2 media storage — env-var fallback for resolveSetting(); requires the
    // MEDIA_BUCKET binding in wrangler.toml plus this public base URL (a custom domain or
    // the bucket's r2.dev subdomain — R2 buckets are private by default).
    r2PublicUrl: '',
    // S3-compatible media storage — env-var fallback for resolveSetting(); the admin
    // Settings → Media UI writes real per-site overrides to the DB on top of these.
    s3Bucket: '',
    s3AccessKey: '',
    s3SecretKey: '',
    s3Region: 'us-east-1',
    s3Endpoint: '',
    s3PublicUrl: '',
    // Bunny.net media storage — same env-var fallback pattern as S3 above.
    bunnyApiKey: '',
    bunnyStorageZone: '',
    bunnyPullZone: '',
    // AI providers — env-var fallback for resolveSetting(); the admin Settings → AI UI
    // writes real per-site overrides to the DB (ai.provider / ai.*_api_key / etc.) on
    // top of these, same DB-first-env-fallback pattern as every other subsystem here.
    aiProvider: '',
    openaiApiKey: '',
    anthropicApiKey: '',
    geminiApiKey: '',
    deepseekApiKey: '',
    ollamaUrl: '',
    ollamaModel: '',
    emailProvider: 'console',
    emailFromAddress: '',
    resendApiKey: '',
    brevoApiKey: '',
    zeptoApiKey: '',
    // Payments plugin
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    lsApiKey: '',
    lsStoreId: '',
    lsWebhookSecret: '',
    paddleApiKey: '',
    paddleVendorId: '',
    paddleWebhookSecret: '',
    isDemo: false,
    // Data retention — configurable via env vars; sensible defaults for most deployments
    auditLogRetentionDays: 90,   // NUXT_AUDIT_LOG_RETENTION_DAYS
    revisionRetentionCount: 20,  // NUXT_REVISION_RETENTION_COUNT
    public: {
      siteUrl: '',
      cloudflareImagesDeliveryUrl: '',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false, // run separately with `nuxt typecheck`
  },

  // nuxt-seo-utils: Open Graph defaults and structured data helpers
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL || 'https://example.com',
    name: 'NuxFlow',
    description: 'A CMS powered by NuxFlow',
    defaultLocale: 'en',
    identity: {
      type: 'Organization',
    },
    twitter: '@nuxflow',
    trailingSlash: false,
    indexable: process.env.NODE_ENV === 'production',
  },

  vite: {
    optimizeDeps: {
      include: [
        '@tiptap/vue-3',
        '@tiptap/starter-kit',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-link',
        '@tiptap/extension-underline',
        '@tiptap/extension-highlight',
        '@tiptap/extension-table',
      ],
    },
  },

  devtools: { enabled: true },
})
