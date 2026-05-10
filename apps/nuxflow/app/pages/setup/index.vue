<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const step = ref(1)
const totalSteps = 5

const form = reactive({
  site: { name: '', domain: '', locale: 'en', timezone: 'UTC' },
  admin: { name: '', email: '', password: '' },
  email: { provider: 'console' as const },
})

const loading = ref(false)
const error = ref('')

const steps = [
  { id: 1, label: 'Site details', icon: 'i-lucide-globe' },
  { id: 2, label: 'Admin account', icon: 'i-lucide-user' },
  { id: 3, label: 'Email settings', icon: 'i-lucide-mail' },
  { id: 4, label: 'Appearance', icon: 'i-lucide-palette' },
  { id: 5, label: 'All done!', icon: 'i-lucide-check-circle' },
]

const { signIn } = useUserSession()
const needsSetup = useState<boolean | null>('setup:needs-setup')

function next() {
  if (step.value < totalSteps) step.value++
}

function back() {
  if (step.value > 1) step.value--
}

async function complete() {
  loading.value = true
  error.value = ''
  try {
    try {
      await $fetch('/api/v1/setup/complete', {
        method: 'POST',
        body: { site: form.site, admin: form.admin, email: form.email },
      })
      clearNuxtData('/api/v1/setup/status')
    } catch (e: unknown) {
      // 409 means setup already ran successfully on a previous attempt — treat as success
      const fe = e as { status?: number; statusCode?: number; data?: { statusCode?: number } }
      const status = fe.status ?? fe.statusCode ?? fe.data?.statusCode
      if (status !== 409) throw e
    }
    // Clear stale setup-guard state so navigating to / doesn't loop back to /setup
    needsSetup.value = false
    // Auto sign-in is best-effort — if it fails the user lands on / and can sign in manually
    try {
      await signIn.email({ email: form.admin.email, password: form.admin.password })
    } catch { /* non-fatal */ }
    step.value = totalSteps
  } catch (e: unknown) {
    const fe = e as { data?: { message?: string }; message?: string }
    error.value = fe.data?.message ?? fe.message ?? 'Setup failed. Check the browser console for details.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Logo + Title -->
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-500 mb-4">
        <UIcon name="i-lucide-layers" class="w-6 h-6 text-white" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Welcome to NuxFlow</h1>
      <p class="mt-1 text-sm text-gray-500">Let's get your site ready in a few steps</p>
    </div>

    <!-- Step indicator -->
    <div class="flex items-center justify-center gap-2">
      <template v-for="s in steps" :key="s.id">
        <div
          class="flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors"
          :class="s.id < step
            ? 'bg-primary-500 text-white'
            : s.id === step
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300 ring-2 ring-primary-500'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800'"
        >
          <UIcon v-if="s.id < step" name="i-lucide-check" class="w-4 h-4" />
          <span v-else>{{ s.id }}</span>
        </div>
        <div
          v-if="s.id < steps.length"
          class="w-8 h-px transition-colors"
          :class="s.id < step ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'"
        />
      </template>
    </div>

    <!-- Step content -->
    <div class="glass rounded-2xl p-6">
      <SetupStepSite v-if="step === 1" v-model="form.site" @next="next" />
      <SetupStepAdmin v-else-if="step === 2" v-model="form.admin" @next="next" @back="back" />
      <SetupStepEmail v-else-if="step === 3" v-model="form.email" @next="next" @back="back" />
      <SetupStepAppearance v-else-if="step === 4" :loading="loading" :error="error" @next="complete" @back="back" />
      <SetupStepDone v-else-if="step === 5" />
    </div>
  </div>
</template>
