<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const signInSocialAction = useSignIn('social')

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

const form = reactive({ name: '', email: '', password: '', confirmPassword: '' })
const loading = ref(false)
const error = ref('')
const success = ref(false)

const { data: regStatus } = await useFetch<{ enabled: boolean }>('/api/public/auth/registration-status')
const registrationEnabled = computed(() => regStatus.value?.enabled ?? false)

const SOCIAL_ERROR_MESSAGES: Record<string, string> = {
  'account_not_linked': 'This social account is already linked to an existing user. Please sign in instead.',
  'account-already-linked': 'That social account is already connected to a different user.',
  'provider-not-found': 'This sign-in provider is not enabled.',
}

onMounted(() => {
  const queryError = route.query.error as string | undefined
  if (queryError) {
    error.value = SOCIAL_ERROR_MESSAGES[queryError] ?? `Sign-in error: ${queryError}`
  }
})

async function submit() {
  error.value = ''
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

async function signInSocial(provider: 'google' | 'github') {
  await signInSocialAction.execute({ provider, callbackURL: '/admin' })
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

    <!-- Registration disabled -->
    <div v-if="!registrationEnabled" class="rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60 p-6 text-center space-y-3">
      <UIcon name="i-lucide-lock" class="w-10 h-10 text-amber-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Registration is currently closed</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">New account creation is disabled. Please contact the site administrator if you need access.</p>
      <NuxtLink to="/login" class="inline-block text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
        Back to sign in
      </NuxtLink>
    </div>

    <!-- Success -->
    <div v-else-if="success" class="rounded-2xl border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/30 p-6 text-center space-y-3">
      <UIcon name="i-lucide-circle-check" class="w-10 h-10 text-green-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Account created!</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">Your account is ready. Sign in to get started.</p>
      <UButton to="/login" color="success" variant="soft" size="sm" leading-icon="i-lucide-log-in">
        Sign in now
      </UButton>
    </div>

    <!-- Registration form -->
    <UForm v-else :schema="schema" :state="form" class="glass rounded-2xl p-6 space-y-4" @submit="submit">
      <p class="text-sm text-center text-gray-500 dark:text-gray-400">Join us — it only takes a moment</p>

      <div class="grid grid-cols-2 gap-3">
        <UButton variant="outline" block @click="signInSocial('google')">
          <UIcon name="i-simple-icons-google" class="w-4 h-4 mr-2" />
          Google
        </UButton>
        <UButton variant="outline" block @click="signInSocial('github')">
          <UIcon name="i-simple-icons-github" class="w-4 h-4 mr-2" />
          GitHub
        </UButton>
      </div>

      <div class="relative flex items-center gap-3">
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span class="text-xs text-gray-400">or sign up with email</span>
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      <UFormField name="name" label="Full name">
        <UInput v-model="form.name" placeholder="Jane Smith" autocomplete="name" class="w-full" autofocus />
      </UFormField>

      <UFormField name="email" label="Email address">
        <UInput v-model="form.email" type="email" placeholder="you@example.com" autocomplete="email" class="w-full" />
      </UFormField>

      <UFormField name="password" label="Password" hint="At least 8 characters">
        <UInput v-model="form.password" type="password" placeholder="••••••••" autocomplete="new-password" class="w-full" />
      </UFormField>

      <UFormField name="confirmPassword" label="Confirm password">
        <UInput v-model="form.confirmPassword" type="password" placeholder="••••••••" autocomplete="new-password" class="w-full" />
      </UFormField>

      <div v-if="error" class="rounded-lg bg-red-600 dark:bg-red-700 px-4 py-3">
        <p class="text-sm font-medium text-white">{{ error }}</p>
      </div>

      <UButton type="submit" block :loading="loading">
        Create account
      </UButton>

      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        Already have an account?
        <NuxtLink to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">Sign in</NuxtLink>
      </p>
    </UForm>
  </div>
</template>
