<script setup lang="ts">
// Shown instead of a password-protected page (e.g. a client gallery) until the visitor
// enters its password. A right password sets an unlock cookie (POST
// /api/public/page-unlock); the parent then reloads the page.
const props = defineProps<{ title?: string; path: string }>()
const emit = defineEmits<{ unlocked: [] }>()

const password = ref('')
const show = ref(false)
const submitting = ref(false)
const errorMessage = ref('')

async function submit() {
  if (!password.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch<{ ok: boolean }>('/api/public/page-unlock', {
      method: 'POST',
      body: { path: props.path, password: password.value },
    })
    emit('unlocked')
  }
  catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode
    errorMessage.value = status === 429
      ? 'Too many attempts. Please wait a minute and try again.'
      : getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="nuxflow-password-gate min-h-[60vh] flex items-center justify-center px-6 py-16">
    <form class="w-full max-w-sm text-center space-y-5" @submit.prevent="submit">
      <UIcon name="i-lucide-lock" class="w-10 h-10 mx-auto opacity-60" />
      <div class="space-y-1">
        <h1 v-if="title" class="text-2xl font-semibold">{{ title }}</h1>
        <p class="text-sm opacity-75">This page is password protected. Enter the password to view it.</p>
      </div>
      <UInput
        v-model="password"
        :type="show ? 'text' : 'password'"
        placeholder="Password"
        autocomplete="current-password"
        aria-label="Password"
        size="lg"
        class="w-full"
        autofocus
      >
        <template #trailing>
          <UButton
            variant="link"
            color="neutral"
            size="sm"
            :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="show ? 'Hide password' : 'Show password'"
            @click="show = !show"
          />
        </template>
      </UInput>
      <p v-if="errorMessage" class="text-sm text-red-600" role="alert">{{ errorMessage }}</p>
      <UButton type="submit" block size="lg" :loading="submitting" :disabled="!password">View page</UButton>
    </form>
  </div>
</template>
