<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const form = reactive({ name: '', email: '', password: '', confirmPassword: '' })
const loading = ref(false)
const error = ref('')
const success = ref(false)

const { data: regStatus } = await useFetch<{ enabled: boolean }>('/api/public/auth/registration-status')
const registrationEnabled = computed(() => regStatus.value?.enabled ?? false)

async function submit() {
  error.value = ''
  if (form.password !== form.confirmPassword) {
    error.value = 'Passwords do not match'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/public/auth/register', {
      method: 'POST',
      body: { name: form.name, email: form.email, password: form.password },
    })
    success.value = true
  } catch (e: unknown) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Registration failed. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-500 mb-4 shadow-lg shadow-primary-500/30">
        <UIcon name="i-lucide-user-plus" class="w-6 h-6 text-white" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Create an account</h1>
    </div>

    <!-- Registration is disabled — shown immediately on page load, no form presented -->
    <div v-if="!registrationEnabled" class="rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60 p-6 text-center space-y-3">
      <UIcon name="i-lucide-lock" class="w-10 h-10 text-amber-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Registration is currently closed</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">New account creation is disabled. Please contact the site administrator if you need access.</p>
      <NuxtLink to="/login" class="inline-block text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
        Back to sign in
      </NuxtLink>
    </div>

    <!-- Success: account created, redirect to login to sign in -->
    <div v-else-if="success" class="rounded-2xl border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/30 p-6 text-center space-y-3">
      <UIcon name="i-lucide-circle-check" class="w-10 h-10 text-green-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Account created!</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">Your account is ready. Sign in to get started.</p>
      <UButton to="/login" color="green" variant="soft" size="sm" leading-icon="i-lucide-log-in">
        Sign in now
      </UButton>
    </div>

    <!-- Registration form -->
    <form v-else class="glass rounded-2xl p-6 space-y-4" @submit.prevent="submit">
      <p class="text-sm text-center text-gray-500 dark:text-gray-400">Join us — it only takes a moment</p>

      <UFormField label="Full name">
        <UInput v-model="form.name" placeholder="Jane Smith" autocomplete="name" class="w-full" autofocus />
      </UFormField>

      <UFormField label="Email address">
        <UInput v-model="form.email" type="email" placeholder="you@example.com" autocomplete="email" class="w-full" />
      </UFormField>

      <UFormField label="Password" hint="At least 8 characters">
        <UInput v-model="form.password" type="password" placeholder="••••••••" autocomplete="new-password" class="w-full" />
      </UFormField>

      <UFormField label="Confirm password">
        <UInput v-model="form.confirmPassword" type="password" placeholder="••••••••" autocomplete="new-password" class="w-full" />
      </UFormField>

      <!-- Error: solid background ensures visibility on the glass card -->
      <div v-if="error" class="rounded-lg bg-red-600 dark:bg-red-700 px-4 py-3">
        <p class="text-sm font-medium text-white">{{ error }}</p>
      </div>

      <UButton
        type="submit"
        block
        :loading="loading"
        :disabled="!form.name || !form.email || !form.password || !form.confirmPassword"
      >
        Create account
      </UButton>

      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        Already have an account?
        <NuxtLink to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">Sign in</NuxtLink>
      </p>
    </form>
  </div>
</template>
