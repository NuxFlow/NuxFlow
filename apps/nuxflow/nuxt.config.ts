import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const _dirname = fileURLToPath(new URL('.', import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2025-01-01',

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
    '@onmax/nuxt-better-auth',
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
    },
    serverAssets: [
      { baseName: 'migrations', dir: resolve(_dirname, '../../packages/db/migrations') },
    ],
  },

  ui: {
    // Nuxt UI Pro configuration — Nuxt green as primary + semantic colors
    theme: {
      colors: ['green', 'red', 'blue', 'yellow', 'orange', 'gray'],
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
    defaultLocale: 'en',
    locales: [{ code: 'en', file: 'en.json', name: 'English' }],
    langDir: resolve(_dirname, 'app/locales'),
    strategy: 'no_prefix',
  },

  auth: {
    redirects: {
      login: '/login',
      guest: '/admin',
      logout: '/login',
    },
    preserveRedirect: true,
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
    paddleWebhookPublicKey: '',
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
