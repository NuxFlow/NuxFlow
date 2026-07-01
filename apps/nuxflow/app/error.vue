<script setup lang="ts">
const error = useError()
const router = useRouter()

const code = computed(() => error.value?.statusCode ?? 500)

const title = computed(() => {
  switch (code.value) {
    case 404: return 'Page not found'
    case 403: return 'Access denied'
    case 401: return 'Sign in required'
    case 429: return 'Too many requests'
    case 503: return 'Service unavailable'
    default: return 'Something went wrong'
  }
})

const description = computed(() => {
  switch (code.value) {
    case 404: return "The page you're looking for doesn't exist or has been moved."
    case 403: return "You don't have permission to view this page."
    case 401: return 'Please sign in to access this page.'
    case 429: return "You've made too many requests. Please wait a moment and try again."
    case 503: return 'The service is temporarily unavailable. Please try again shortly.'
    default: return 'An unexpected error occurred. Please try again later.'
  }
})
</script>

<template>
  <div class="mesh-bg min-h-screen flex flex-col items-center justify-center px-4">
    <div class="glass-xl rounded-2xl p-10 max-w-md w-full text-center space-y-6">
      <p class="text-8xl font-bold opacity-15 select-none leading-none">
        {{ code }}
      </p>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">
          {{ title }}
        </h1>
        <p class="text-sm text-[var(--ui-text-muted)]">
          {{ description }}
        </p>
      </div>
      <div class="flex gap-3 justify-center">
        <UButton
          size="lg"
          @click="clearError({ redirect: '/' })"
        >
          Back to home
        </UButton>
        <UButton
          size="lg"
          variant="outline"
          @click="router.back()"
        >
          Go back
        </UButton>
      </div>
    </div>
  </div>
</template>
