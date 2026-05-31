<script setup lang="ts">
onMounted(() => {
  // Hard navigate to bypass the setup-guard middleware's cached useFetch state.
  // A full page reload ensures fresh auth session + setup status checks.
  setTimeout(() => { window.location.href = '/' }, 2500)
})
</script>

<template>
  <div class="text-center space-y-6 py-4">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900">
      <UIcon name="i-lucide-check-circle" class="w-8 h-8 text-primary-500" />
    </div>

    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">You're all set!</h2>
      <p class="text-sm text-gray-500 mt-2">Your NuxFlow site is ready. Taking you to your homepage…</p>
    </div>

    <UProgress animation="carousel" class="max-w-xs mx-auto" />
  </div>
</template>
