<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

const route = useRoute()
const form = reactive({ password: '', confirmPassword: '' })
const loading = ref(false)
const error = ref('')
const success = ref(false)

const token = computed(() => route.query.token as string | undefined)

async function submit() {
  error.value = ''
  if (!token.value) {
    error.value = 'Invalid or expired reset link'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { newPassword: form.password, token: token.value },
    })
    success.value = true
    setTimeout(() => navigateTo('/login'), 2500)
  } catch (e: unknown) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Reset failed. The link may have expired.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-500 mb-4 shadow-lg shadow-primary-500/30">
        <UIcon name="i-lucide-lock-keyhole" class="w-6 h-6 text-white" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Reset your password</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose a new password for your account</p>
    </div>

    <div v-if="!token" class="glass rounded-2xl p-6 text-center space-y-3">
      <UIcon name="i-lucide-circle-x" class="w-10 h-10 text-red-400 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Invalid reset link</p>
      <p class="text-sm text-gray-500">This link is missing a token. Please request a new reset link.</p>
      <NuxtLink to="/forgot-password" class="text-primary-500 hover:underline text-sm">Request new link</NuxtLink>
    </div>

    <div v-else-if="success" class="glass rounded-2xl p-6 text-center space-y-3">
      <UIcon name="i-lucide-circle-check" class="w-10 h-10 text-green-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Password updated!</p>
      <p class="text-sm text-gray-500">Redirecting you to sign in…</p>
    </div>

    <UForm v-else :schema="schema" :state="form" class="glass rounded-2xl p-6 space-y-4" @submit="submit">
      <UFormField name="password" label="New password" hint="At least 8 characters">
        <UInput v-model="form.password" type="password" placeholder="••••••••" autocomplete="new-password" class="w-full" autofocus />
      </UFormField>

      <UFormField name="confirmPassword" label="Confirm new password">
        <UInput v-model="form.confirmPassword" type="password" placeholder="••••••••" autocomplete="new-password" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="red" variant="soft" :description="error" />

      <UButton type="submit" block :loading="loading">
        Reset password
      </UButton>
    </UForm>
  </div>
</template>
