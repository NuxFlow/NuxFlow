<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const { isAccountsHost, onSiteDomain, signInUrl } = useAccounts()

// Under central sign-in a site's own domain never shows a password field — where that
// site's admins can add their own scripts. (The server already redirects /login there;
// this covers arriving by client-side navigation.)
if (onSiteDomain) {
  await navigateTo(signInUrl(typeof route.query.redirect === 'string' ? route.query.redirect : '/admin'), { external: true })
}

const { siteId, site } = await useAccountsSite()

// Where to go once signed in. On the accounts origin that's `next` (e.g. back into the
// /authorize handoff for a site) or the account page; on a single-site install, the
// `redirect` it was sent here with.
const destination = computed(() => isAccountsHost
  ? safeNextPath(route.query.next, siteId.value ? `/authorize?${new URLSearchParams({ site: siteId.value })}` : '/account')
  : safeNextPath(route.query.redirect, '/admin'))

// Already signed in on the accounts origin — nothing to do here.
const { loggedIn } = useUserSession()
if (isAccountsHost && loggedIn.value) {
  await navigateTo(destination.value)
}

const signInEmail = useSignIn('email')
const signInPasskey = useSignIn('passkey')
const signInSocialAction = useSignIn('social')

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const form = reactive({ email: '', password: '', rememberMe: true })
const loading = ref(false)
const error = ref('')
const verified = ref(false)

const SOCIAL_ERROR_MESSAGES: Record<string, string> = {
  'account_not_linked': 'This Google/GitHub account isn\'t linked to any NuxFlow account. Sign in with your email and password first, then connect your social account from your account page.',
  'account-already-linked': 'That social account is already connected to a different user.',
  'provider-not-found': 'This sign-in provider is not enabled.',
}

onMounted(() => {
  const queryError = route.query.error as string | undefined
  if (queryError) {
    error.value = SOCIAL_ERROR_MESSAGES[queryError] ?? `Sign-in error: ${queryError}`
  }
  if (route.query.verified === '1') {
    verified.value = true
  }
})

function carry(path: string): string {
  const params = new URLSearchParams()
  if (siteId.value) params.set('site', siteId.value)
  if (isAccountsHost && typeof route.query.next === 'string') params.set('next', route.query.next)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await signInEmail.execute({
      email: form.email,
      password: form.password,
      rememberMe: form.rememberMe,
    })
    if (signInEmail.error.value) {
      error.value = signInEmail.error.value.message ?? 'Invalid email or password'
      return
    }
    window.location.href = destination.value
  } catch {
    error.value = 'Invalid email or password'
  } finally {
    loading.value = false
  }
}

async function signInWithPasskey() {
  loading.value = true
  error.value = ''
  try {
    await signInPasskey.execute()
    if (signInPasskey.error.value) {
      error.value = signInPasskey.error.value.message ?? 'Biometric authentication failed'
      return
    }
    window.location.href = destination.value
  } catch {
    error.value = 'Biometric authentication failed or cancelled'
  } finally {
    loading.value = false
  }
}

async function signInSocial(provider: 'google' | 'github') {
  await signInSocialAction.execute({ provider, callbackURL: destination.value })
}
</script>

<template>
  <div class="space-y-6">
    <AccountsSiteBrand
      :site="site"
      :heading="site ? `Sign in to ${site.name}` : 'Sign in to NuxFlow'"
      :subheading="isAccountsHost ? 'One account for every NuxFlow site — you only ever enter your password here.' : 'Welcome back — enter your details below'"
    />

    <UForm :schema="schema" :state="form" class="glass rounded-2xl p-6 space-y-4" @submit="submit">
      <UFormField name="email" label="Email address">
        <UInput v-model="form.email" type="email" placeholder="you@example.com" autocomplete="email" class="w-full" />
      </UFormField>

      <UFormField name="password" label="Password">
        <UInput v-model="form.password" type="password" placeholder="••••••••" autocomplete="current-password" class="w-full" />
      </UFormField>

      <div class="flex items-center justify-between">
        <UCheckbox v-model="form.rememberMe" label="Keep me signed in" />
        <NuxtLink :to="carry('/forgot-password')" class="text-xs text-primary-500 hover:underline">Forgot password?</NuxtLink>
      </div>

      <UAlert v-if="verified" color="success" variant="soft" description="Email verified — you can sign in now." />
      <UAlert v-if="error" color="error" variant="soft" :description="error" />

      <div class="flex flex-col gap-2">
        <UButton type="submit" block :loading="loading">Sign in</UButton>
        <UButton
          type="button"
          block
          variant="subtle"
          icon="i-lucide-fingerprint"
          :loading="loading"
          @click="signInWithPasskey"
        >
          Sign in with Passkey
        </UButton>
      </div>

      <div class="relative flex items-center gap-3">
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span class="text-xs text-gray-400">or</span>
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

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

      <!-- Registration is per site (a site's own "public registration" setting), so on the
           accounts origin it's only offered when signing in to a particular site. -->
      <p v-if="!isAccountsHost || site?.allowRegistration" class="text-center text-sm text-gray-500 dark:text-gray-400">
        Don't have an account?
        <NuxtLink :to="carry('/register')" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">Sign up</NuxtLink>
      </p>
    </UForm>
  </div>
</template>
