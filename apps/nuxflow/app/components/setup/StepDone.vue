<script setup lang="ts">
const props = defineProps<{ finishInAdmin?: boolean }>()
const { onSiteDomain } = useAccounts()

onMounted(() => {
  // Hard navigate to bypass the setup-guard middleware's cached useFetch state.
  // A full page reload ensures fresh auth session + setup status checks. Under central
  // sign-in the new admin isn't signed in on this domain yet, so /admin sends them
  // through the accounts origin first.
  setTimeout(() => { window.location.href = onSiteDomain || props.finishInAdmin ? '/admin' : '/' }, 2500)
})

// Under central sign-in (a hosting platform, or any install with NUXT_PUBLIC_ACCOUNTS_URL)
// passwords are only accepted on the accounts origin, so the wizard can't sign the new
// admin in here — say so, rather than promising a dashboard and showing a sign-in page.
const message = computed(() => {
  if (onSiteDomain) {
    return props.finishInAdmin
      ? 'Next, sign in with the email and password you just chose. Your starter site\'s pages and images are added as soon as you reach your dashboard…'
      : 'Your site is ready. Next, sign in with the email and password you just chose to open your dashboard…'
  }
  return props.finishInAdmin ? 'Taking you to your dashboard to finish installing your starter site…' : 'Your NuxFlow site is ready. Taking you to your homepage…'
})
</script>

<template>
  <div class="text-center space-y-6 py-4">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900">
      <UIcon name="i-lucide-check-circle" class="w-8 h-8 text-primary-500" />
    </div>

    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ finishInAdmin ? 'Almost there!' : "You're all set!" }}</h2>
      <p class="text-sm text-gray-500 mt-2">{{ message }}</p>
    </div>

    <UProgress animation="carousel" class="max-w-xs mx-auto" />
  </div>
</template>
