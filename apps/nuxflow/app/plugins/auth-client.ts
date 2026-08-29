import { createNuxflowAuthClient, type NuxflowAuthClient } from '~/utils/auth-client'

declare module '#app' {
  interface NuxtApp {
    $authClient: NuxflowAuthClient
  }
}

// Isomorphic (no .client/.server suffix): login.vue and setup/index.vue call
// useSignIn() at top-level <script setup>, which also runs during SSR, so
// $authClient must exist there too. A fresh client is built per Nuxt app
// instance (i.e. per request on the server) rather than a module-scope
// singleton, so one request's resolved baseURL can never leak into another
// request sharing the same Cloudflare Worker isolate.
export default defineNuxtPlugin(() => {
  return {
    provide: {
      authClient: createNuxflowAuthClient(),
    },
  }
})
