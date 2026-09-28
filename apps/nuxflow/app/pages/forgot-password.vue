<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const { onSiteDomain, accountsLink } = useAccounts()
// Password resets happen on the accounts origin under central sign-in (the server
// redirects this path there too; this covers client-side navigation).
if (onSiteDomain) await navigateTo(accountsLink('/forgot-password'), { external: true })
const { siteId, site } = await useAccountsSite()

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})

const state = reactive({ email: '' })
const loading = ref(false)
const sent = ref(false)

async function submit() {
  loading.value = true
  try {
    // Uses the typed auth client method (rather than a hardcoded fetch path) so a
    // future Better Auth endpoint rename fails typecheck instead of silently 404ing —
    // this exact page previously broke that way when the underlying endpoint was
    // renamed from /forget-password to /request-password-reset.
    // `site` (when resetting on the way into a particular site) brands the email and the
    // reset page, and brings them back to that site afterwards.
    const redirectTo = siteId.value ? `/reset-password?${new URLSearchParams({ site: siteId.value })}` : '/reset-password'
    await useAuthClient().requestPasswordReset({ email: state.email, redirectTo })
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
    <AccountsSiteBrand
      :site="site"
      fallback-icon="i-lucide-key-round"
      heading="Forgot password"
      subheading="Enter your email and we'll send a reset link"
    />

    <div v-if="sent" class="glass rounded-2xl p-6 text-center space-y-3">
      <UIcon name="i-lucide-mail-check" class="w-10 h-10 text-green-500 mx-auto" />
      <p class="font-semibold text-gray-900 dark:text-white">Check your inbox</p>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        If an account exists for <strong>{{ state.email }}</strong>, a reset link has been sent.
      </p>
      <NuxtLink :to="siteId ? `/login?site=${encodeURIComponent(siteId)}` : '/login'" class="text-primary-500 hover:underline text-sm">Back to sign in</NuxtLink>
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
        <NuxtLink :to="siteId ? `/login?site=${encodeURIComponent(siteId)}` : '/login'" class="text-primary-500 hover:underline font-medium">Sign in</NuxtLink>
      </p>
    </UForm>
  </div>
</template>
