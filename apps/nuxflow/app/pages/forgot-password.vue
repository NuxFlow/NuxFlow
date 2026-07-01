<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})

const state = reactive({ email: '' })
const loading = ref(false)
const sent = ref(false)

async function submit() {
  loading.value = true
  try {
    await $fetch('/api/auth/forget-password', {
      method: 'POST',
      body: { email: state.email, redirectTo: '/reset-password' },
    })
    sent.value = true
  } catch {
    // Always show success to prevent email enumeration
    sent.value = true
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-500 mb-4 shadow-lg shadow-primary-500/30">
        <UIcon name="i-lucide-key-round" class="w-6 h-6 text-white" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Forgot password</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter your email and we'll send a reset link</p>
    </div>

    <div v-if="sent" class="glass rounded-2xl p-6 text-center space-y-3">
      <UIcon name="i-lucide-mail-check" class="w-10 h-10 text-green-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Check your inbox</p>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        If an account exists for <strong>{{ state.email }}</strong>, a reset link has been sent.
      </p>
      <NuxtLink to="/login" class="text-primary-500 hover:underline text-sm">Back to sign in</NuxtLink>
    </div>

    <UForm v-else :schema="schema" :state="state" class="glass rounded-2xl p-6 space-y-4" @submit="submit">
      <UFormField name="email" label="Email address">
        <UInput v-model="state.email" type="email" placeholder="you@example.com" autocomplete="email" class="w-full" autofocus />
      </UFormField>

      <UButton type="submit" block :loading="loading">
        Send reset link
      </UButton>

      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        Remembered it?
        <NuxtLink to="/login" class="text-primary-500 hover:underline font-medium">Sign in</NuxtLink>
      </p>
    </UForm>
  </div>
</template>
