import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const _dirname = fileURLToPath(new URL('.', import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2025-01-01',

  css: ['~/assets/css/main.css'],

  modules: [
    '@nuxt/ui-pro',
    '@nuxtjs/i18n',
    '@onmax/nuxt-better-auth',
    '@pinia/nuxt',
    'motion-v/nuxt',
    'nuxt-seo-utils',
  ],

  // Workaround for https://github.com/nuxt/nuxt/issues/34727
  // Windows Named Pipe IPC crash in @nuxt/vite-builder@4.4.2 + Vite 7.3.x
  ssr: process.env.NODE_ENV !== 'development',

  nitro: {
    preset: process.env.NODE_ENV === 'production' ? 'cloudflare-module' : undefined,
    experimental: {
      wasm: true,
    },
    // @better-auth/core ships optional OpenTelemetry instrumentation that imports
    // @opentelemetry/api. That package is not installed and Cloudflare Pages preset
    // forbids externals, so we stub it out here.
    alias: {
      '@opentelemetry/api': resolve(_dirname, 'server/stubs/opentelemetry-api.mjs'),
    },
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
    restructureDir: false,
    defaultLocale: 'en',
    locales: [{ code: 'en', file: 'en.json', name: 'English' }],
    lazy: true,
    langDir: 'locales/',
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
    tursoUrl: '',
    tursoAuthToken: '',
    betterAuthSecret: '',
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    cloudflareImagesToken: '',
    cloudflareAccountId: '',
    cloudflareImagesDeliveryUrl: '',
    emailProvider: 'console',
    resendApiKey: '',
    brevoApiKey: '',
    zeptoApiKey: '',
    smtpHost: '',
    smtpPort: '',
    smtpUser: '',
    smtpPass: '',
    // Payments plugin
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    lsApiKey: '',
    lsStoreId: '',
    lsWebhookSecret: '',
    paddleApiKey: '',
    paddleVendorId: '',
    paddleWebhookPublicKey: '',
    public: {
      siteUrl: '',
      cloudflareImagesDeliveryUrl: '',
      turnstileSiteKey: '',
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
    description: 'A headless CMS powered by NuxFlow',
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
      ],
    },
  },

  devtools: { enabled: true },
})
