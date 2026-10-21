<script setup lang="ts">
import { SIGNUP_STORAGE_KEY, type SignupReward } from '#shared/lib/signup-prompt'

// Double opt-in landing page — the link in the confirmation email. Confirming takes a
// button press (a POST), not just opening the link: mail scanners open every link in an
// email, and would otherwise confirm addresses nobody actually confirmed.

const route = useRoute()
useSeoMeta({ title: 'Confirm your subscription', robots: 'noindex,nofollow' })

const id = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const loading = ref(false)
const error = ref('')
const done = ref<{ heading: string; body: string; reward: SignupReward | null } | null>(null)

async function confirm() {
  error.value = ''
  loading.value = true
  try {
    done.value = await $fetch<{ heading: string; body: string; reward: SignupReward | null }>('/api/public/mailing-list/confirm', { method: 'POST', body: { id: id.value, token: token.value } })
    try {
      const raw = localStorage.getItem(SIGNUP_STORAGE_KEY)
      localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), subscribed: true }))
    }
    catch {
      // Storage blocked.
    }
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'This confirmation link is not valid.')
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
      <h1 class="text-2xl font-bold">{{ done.heading }}</h1>
      <p v-if="done.body" class="opacity-80 whitespace-pre-line">{{ done.body }}</p>
      <div v-if="done.reward" class="space-y-3 pt-2">
        <p v-if="done.reward.text" class="font-medium whitespace-pre-line select-all">{{ done.reward.text }}</p>
        <UButton v-if="done.reward.url" :to="done.reward.url" target="_blank" external>{{ done.reward.label }}</UButton>
      </div>
      <UButton to="/" variant="ghost">Back to the site</UButton>
    </template>
    <template v-else-if="!id || !token">
      <h1 class="text-2xl font-bold">Link incomplete</h1>
      <p class="opacity-80">This link is missing part of its address. Try copying the whole link from the email.</p>
    </template>
    <template v-else>
      <UIcon name="i-lucide-mail-check" class="w-12 h-12 text-primary-500 mx-auto" />
      <h1 class="text-2xl font-bold">Confirm your subscription</h1>
      <p class="opacity-80">One click and you're on the list.</p>
      <UButton size="lg" :loading="loading" @click="confirm">Yes, subscribe me</UButton>
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
