<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const signInEmail = useSignIn('email')
const signInPasskey = useSignIn('passkey')
const signInSocialAction = useSignIn('social')

const form = reactive({ email: '', password: '', rememberMe: true })
const loading = ref(false)
const error = ref('')

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
    window.location.href = (route.query.redirect as string) || '/admin'
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
    window.location.href = (route.query.redirect as string) || '/admin'
  } catch {
    error.value = 'Biometric authentication failed or cancelled'
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
    <!-- Logo + heading -->
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-500 mb-4 shadow-lg shadow-primary-500/30">
        <UIcon name="i-lucide-layers" class="w-6 h-6 text-white" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Sign in to NuxFlow</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Welcome back — enter your details below</p>
    </div>

    <!-- Glass card -->
    <form class="glass rounded-2xl p-6 space-y-4" @submit.prevent="submit">
      <UFormField label="Email address">
        <UInput v-model="form.email" type="email" placeholder="you@example.com" autocomplete="email" class="w-full" />
      </UFormField>

      <UFormField label="Password">
        <UInput v-model="form.password" type="password" placeholder="••••••••" autocomplete="current-password" class="w-full" />
      </UFormField>

      <div class="flex items-center justify-between">
        <UCheckbox v-model="form.rememberMe" label="Keep me signed in" />
        <NuxtLink to="/forgot-password" class="text-xs text-primary-500 hover:underline">Forgot password?</NuxtLink>
      </div>

      <UAlert v-if="error" color="red" variant="soft" :description="error" />

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
    </form>

  </div>
</template>
