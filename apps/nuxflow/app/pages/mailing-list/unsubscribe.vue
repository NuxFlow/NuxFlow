<script setup lang="ts">
// Unsubscribe landing page — the link in list emails. A button (POST) rather than acting
// on page load, for the same mail-scanner reason as confirm.vue. Mail clients that support
// one-click unsubscribe skip this page and POST to the API directly (RFC 8058).

const route = useRoute()
useSeoMeta({ title: 'Unsubscribe', robots: 'noindex,nofollow' })

const id = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const loading = ref(false)
const error = ref('')
const done = ref(false)

async function unsubscribe() {
  error.value = ''
  loading.value = true
  try {
    await $fetch('/api/public/mailing-list/unsubscribe', { method: 'POST', body: { id: id.value, token: token.value } })
    done.value = true
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'This unsubscribe link is not valid.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20 text-center space-y-4">
    <template v-if="done">
      <UIcon name="i-lucide-circle-check" class="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
      <h1 class="text-2xl font-bold">You've been unsubscribed</h1>
      <p class="opacity-80">You won't get any more emails from this list.</p>
      <UButton to="/" variant="ghost">Back to the site</UButton>
    </template>
    <template v-else-if="!id || !token">
      <h1 class="text-2xl font-bold">Link incomplete</h1>
      <p class="opacity-80">This link is missing part of its address. Try copying the whole link from the email.</p>
    </template>
    <template v-else>
      <h1 class="text-2xl font-bold">Unsubscribe from this list?</h1>
      <p class="opacity-80">You'll stop getting emails from this site's mailing list.</p>
      <UButton size="lg" color="error" :loading="loading" @click="unsubscribe">Unsubscribe</UButton>
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
