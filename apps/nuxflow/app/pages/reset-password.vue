<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const { onSiteDomain, accountsLink } = useAccounts()
// Under central sign-in reset links point at the accounts origin; this covers an old
// link or client-side navigation on a site's own domain.
if (onSiteDomain) await navigateTo(`${accountsLink('/reset-password')}${useRequestURL().search}`, { external: true })
const { siteId, site } = await useAccountsSite()

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
const isInvite = computed(() => route.query.purpose === 'invite')

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
    // Back to signing in — and on into the site the link was for (an invitation or a reset
    // started from a site), if there was one.
    setTimeout(() => navigateTo(siteId.value
      ? `/login?${new URLSearchParams({ site: siteId.value, next: `/authorize?${new URLSearchParams({ site: siteId.value })}` })}`
      : '/login'), 2500)
  } catch (e: unknown) {
    error.value = getErrorMessage(e, 'Reset failed. The link may have expired.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <AccountsSiteBrand
      :site="site"
      fallback-icon="i-lucide-lock-keyhole"
      :heading="isInvite ? (site ? `Join ${site.name}` : 'Accept your invitation') : 'Reset your password'"
      :subheading="isInvite ? 'Choose a password to accept the invitation' : 'Choose a new password for your account'"
    />

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

      <UAlert v-if="error" color="error" variant="soft" :description="error" />

      <UButton type="submit" block :loading="loading">
        Reset password
      </UButton>
    </UForm>
  </div>
</template>
