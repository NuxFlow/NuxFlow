<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const { isAccountsHost, onSiteDomain } = useAccounts()

// Under central sign-in passwords are only ever set on the accounts origin (the server
// already redirects /register there; this covers client-side navigation).
if (onSiteDomain) {
  await navigateTo(`/_nuxflow/auth/start?${new URLSearchParams({ return_to: '/account', intent: 'join' })}`, { external: true })
}

const signInSocialAction = useSignIn('social')
const { siteId, site } = await useAccountsSite()

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

// Registration always belongs to a site (its own "public registration" setting). On the
// accounts origin that's the `site` it was opened for; on a single-site install, this one.
const { data: regStatus } = await useFetch<{ enabled: boolean }>('/api/public/auth/registration-status', { immediate: !isAccountsHost })
const registrationEnabled = computed(() => isAccountsHost ? Boolean(site.value?.allowRegistration) : (regStatus.value?.enabled ?? false))

// After registering on the accounts origin: sign in, then continue into the site as a member.
const joinPath = computed(() => `/authorize?${new URLSearchParams({ site: siteId.value, intent: 'join' })}`)
const signInPath = computed(() => isAccountsHost && siteId.value
  ? `/login?${new URLSearchParams({ site: siteId.value, next: joinPath.value })}`
  : '/login')

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
    if (isAccountsHost) {
      await $fetch('/api/accounts/register', {
        method: 'POST',
        body: { site: siteId.value, name: form.name, email: form.email, password: form.password },
      })
    } else {
      await $fetch('/api/public/auth/register', {
        method: 'POST',
        body: { name: form.name, email: form.email, password: form.password },
      })
    }
    success.value = true
  } catch (e: unknown) {
    error.value = getErrorMessage(e, 'Registration failed. Please try again.')
  } finally {
    loading.value = false
  }
}

async function signInSocial(provider: 'google' | 'github') {
  // A new social account isn't a member of anything yet — continue into the site's join step.
  await signInSocialAction.execute({ provider, callbackURL: isAccountsHost && siteId.value ? joinPath.value : '/admin' })
}
</script>

<template>
  <div class="space-y-6">
    <AccountsSiteBrand
      :site="site"
      fallback-icon="i-lucide-user-plus"
      :heading="site ? `Join ${site.name}` : 'Create an account'"
      :subheading="isAccountsHost ? 'Your account works on every NuxFlow site.' : undefined"
    />

    <!-- Registration disabled -->
    <div v-if="!registrationEnabled" class="rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60 p-6 text-center space-y-3">
      <UIcon name="i-lucide-lock" class="w-10 h-10 text-amber-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Registration is currently closed</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">New account creation is disabled. Please contact the site administrator if you need access.</p>
      <NuxtLink :to="signInPath" class="inline-block text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
        Back to sign in
      </NuxtLink>
    </div>

    <!-- Success -->
    <div v-else-if="success" class="rounded-2xl border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/30 p-6 text-center space-y-3">
      <UIcon name="i-lucide-circle-check" class="w-10 h-10 text-green-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Account created!</p>
      <p class="text-sm text-gray-600 dark:text-gray-400">Your account is ready. Sign in to get started — if you already had an account with this email, sign in with that one instead.</p>
      <UButton :to="signInPath" color="success" variant="soft" size="sm" leading-icon="i-lucide-log-in">
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
        <NuxtLink :to="signInPath" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">Sign in</NuxtLink>
      </p>
    </UForm>
  </div>
</template>
