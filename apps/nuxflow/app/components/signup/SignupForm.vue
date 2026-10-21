<script setup lang="ts">
import { SIGNUP_STORAGE_KEY, type PublicSignupSettings, type SignupReward } from '#shared/lib/signup-prompt'

// The mailing-list form shared by the signup popup (PublicSignupPrompt) and the Signup box
// Canvas block (SignupBlock). Posts to /api/public/mailing-list/subscribe; the texts come
// from Admin → Mailing list via /api/public/site.

const props = withDefaults(defineProps<{
  settings: PublicSignupSettings
  source: 'popup' | 'block'
  buttonLabel?: string
  turnstileSiteKey?: string | null
}>(), {
  buttonLabel: '',
  turnstileSiteKey: null,
})

const emit = defineEmits<{ subscribed: [] }>()

const route = useRoute()
const email = ref('')
const name = ref('')
// Honeypot — hidden from people and screen readers; see subscribe.post.ts.
const website = ref('')
const turnstileToken = ref('')
const loading = ref(false)
const errorMessage = ref('')
const result = ref<{ status: 'pending' | 'subscribed'; reward: SignupReward | null } | null>(null)

const uid = useId()

async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    result.value = await $fetch<{ status: 'pending' | 'subscribed'; reward: SignupReward | null }>('/api/public/mailing-list/subscribe', {
      method: 'POST',
      body: {
        email: email.value,
        name: props.settings.collectName && name.value ? name.value : undefined,
        source: props.source,
        path: route.path,
        website: website.value || undefined,
        turnstileToken: turnstileToken.value || undefined,
      },
    })
    rememberSubscribed()
    emit('subscribed')
  }
  catch (e: unknown) {
    errorMessage.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    loading.value = false
  }
}

function rememberSubscribed() {
  try {
    const raw = localStorage.getItem(SIGNUP_STORAGE_KEY)
    const state = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({ ...state, subscribed: true }))
  }
  catch {
    // Private mode or storage blocked — the popup may come back, nothing worse.
  }
}
</script>

<template>
  <div class="nuxflow-signup-form">
    <div v-if="result" role="status" class="space-y-2">
      <template v-if="result.status === 'pending'">
        <p class="font-semibold">Check your inbox</p>
        <p class="text-sm opacity-80">
          We've sent a link to <strong>{{ email }}</strong>. Click it to finish subscribing.
        </p>
      </template>
      <template v-else>
        <p class="font-semibold">{{ settings.successHeading }}</p>
        <p v-if="settings.successBody" class="text-sm opacity-80 whitespace-pre-line">{{ settings.successBody }}</p>
        <div v-if="result.reward" class="mt-3 space-y-2">
          <p v-if="result.reward.text" class="text-sm font-medium whitespace-pre-line select-all">{{ result.reward.text }}</p>
          <UButton v-if="result.reward.url" :to="result.reward.url" target="_blank" external size="sm">
            {{ result.reward.label }}
          </UButton>
        </div>
      </template>
    </div>

    <form v-else class="space-y-3" @submit.prevent="submit">
      <div v-if="settings.collectName">
        <label :for="`${uid}-name`" class="sr-only">First name</label>
        <UInput :id="`${uid}-name`" v-model="name" placeholder="First name" autocomplete="given-name" maxlength="100" class="w-full" />
      </div>
      <div class="flex flex-col sm:flex-row gap-2">
        <label :for="`${uid}-email`" class="sr-only">Email address</label>
        <UInput
          :id="`${uid}-email`"
          v-model="email"
          type="email"
          required
          placeholder="you@example.com"
          autocomplete="email"
          maxlength="254"
          class="flex-1"
        />
        <UButton type="submit" :loading="loading" class="justify-center">
          {{ buttonLabel || settings.buttonLabel }}
        </UButton>
      </div>
      <div class="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
        <label :for="`${uid}-website`">Website</label>
        <input :id="`${uid}-website`" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
      </div>
      <NuxtTurnstile v-if="turnstileSiteKey" v-model="turnstileToken" :site-key="turnstileSiteKey" />
      <p v-if="errorMessage" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ errorMessage }}</p>
      <p v-if="settings.consentText" class="text-xs opacity-70">{{ settings.consentText }}</p>
    </form>
  </div>
</template>
