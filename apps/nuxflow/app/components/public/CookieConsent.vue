<script setup lang="ts">
// '@nuxflow/canvas/consent', not the package root — see the comment in
// server/plugins/site-settings-resolver.ts on why importing this utility elsewhere in
// the app always goes through this dedicated subpath rather than the root barrel.
import { readConsentCookie, writeConsentCookie } from '@nuxflow/canvas/consent'

// A page that already has its own CanvasBlockGdpr banner sets this flag before this
// component mounts (see the comment on that block) — skip rendering a second banner
// with a separate consent record on top of it. Both banners read/write the same
// nuxflow_consent cookie via @nuxflow/canvas's shared consent utility, so a choice
// made in either one is honoured by the script-injection gate in
// server/plugins/site-settings-resolver.ts.
const gdprBlockPresent = useState('nuxflow:gdpr-banner-present', () => false)

const consent = ref(readConsentCookie())
const show = ref(!gdprBlockPresent.value && !consent.value)

function accept() {
  consent.value = writeConsentCookie(true, true)
  show.value = false
}

function necessary() {
  consent.value = writeConsentCookie(false, false)
  show.value = false
}
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-300"
    enter-from-class="translate-y-full"
    leave-active-class="transition-transform duration-300"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="show"
      class="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg"
    >
      <div class="max-w-4xl mx-auto flex items-center gap-4 flex-wrap">
        <p class="flex-1 text-sm text-gray-600 dark:text-gray-400 min-w-0">
          We use cookies to improve your experience. By continuing, you agree to our use of cookies.
          <NuxtLink to="/privacy" class="text-primary-500 hover:underline ml-1">Privacy Policy</NuxtLink>
        </p>
        <div class="flex gap-2 shrink-0">
          <UButton size="sm" variant="outline" @click="necessary">Necessary only</UButton>
          <UButton size="sm" @click="accept">Accept all</UButton>
        </div>
      </div>
    </div>
  </Transition>
</template>
