<script setup lang="ts">
// The RSVP form on an event page. The page itself is cached whole, so whether places are
// left is fetched here in the browser, and nothing about a visitor is in the cached HTML.

const props = defineProps<{ itemId: string }>()

interface RsvpState {
  enabled: boolean
  state: 'open' | 'waitlist' | 'closed'
  spotsLeft: number | null
  maxSeats: number
}

const { data: site } = useFetch<{ turnstileSiteKey?: string | null }>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

const { user } = useUserSession()
const state = ref<RsvpState | null>(null)
const name = ref('')
const email = ref('')
const seats = ref(1)
// Honeypot — hidden from people and screen readers; see api/public/rsvp/[id].post.ts.
const website = ref('')
const turnstileToken = ref('')
const loading = ref(false)
const errorMessage = ref('')
const result = ref<'pending' | 'confirmed' | 'waitlist' | null>(null)
const uid = useId()

const rsvpUrl = computed<string>(() => `/api/public/rsvp/${props.itemId}`)
const seatOptions = computed(() => Array.from({ length: state.value?.maxSeats ?? 1 }, (_, i) => ({ label: String(i + 1), value: i + 1 })))

onMounted(async () => {
  name.value = user.value?.name ?? ''
  email.value = user.value?.email ?? ''
  try {
    state.value = await $fetch<RsvpState, string>(rsvpUrl.value)
  }
  catch {
    // An RSVP form that can't load is left out; the rest of the event page is unaffected.
  }
})

async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const answer = await $fetch<{ status: 'pending' | 'confirmed' | 'waitlist' }, string>(rsvpUrl.value, {
      method: 'POST',
      body: {
        name: name.value,
        email: email.value,
        seats: seats.value,
        website: website.value || undefined,
        turnstileToken: turnstileToken.value || undefined,
      },
    })
    result.value = answer.status
  }
  catch (e: unknown) {
    errorMessage.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="state?.enabled" class="nuxflow-event-rsvp border-t border-gray-100 dark:border-gray-800 pt-4">
    <div v-if="result" role="status" class="space-y-1">
      <template v-if="result === 'pending'">
        <p class="font-semibold">Check your inbox</p>
        <p class="text-sm opacity-80">We've sent a link to <strong>{{ email }}</strong>. Click it to confirm your place.</p>
      </template>
      <template v-else-if="result === 'confirmed'">
        <p class="font-semibold">You're on the list</p>
        <p class="text-sm opacity-80">See you there.</p>
      </template>
      <template v-else>
        <p class="font-semibold">You're on the waitlist</p>
        <p class="text-sm opacity-80">This event is full at the moment. You'll get a place if one opens up.</p>
      </template>
    </div>

    <p v-else-if="state.state === 'closed'" class="text-sm text-gray-500 dark:text-gray-400">RSVPs for this event are closed.</p>

    <form v-else class="space-y-3" @submit.prevent="submit">
      <div>
        <p class="font-semibold">{{ state.state === 'waitlist' ? 'Join the waitlist' : 'RSVP' }}</p>
        <p v-if="state.state === 'waitlist'" class="text-sm text-gray-500 dark:text-gray-400">This event is full, but you'll get a place if one opens up.</p>
        <p v-else-if="state.spotsLeft !== null" class="text-sm text-gray-500 dark:text-gray-400">{{ state.spotsLeft === 1 ? '1 place left' : `${state.spotsLeft} places left` }}</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <UFormField label="Your name" :name="`${uid}-name`" required>
          <UInput v-model="name" required maxlength="100" autocomplete="name" class="w-full" />
        </UFormField>
        <UFormField label="Email" :name="`${uid}-email`" required>
          <UInput v-model="email" type="email" required maxlength="254" autocomplete="email" class="w-full" />
        </UFormField>
      </div>
      <UFormField v-if="state.maxSeats > 1" label="Places" :name="`${uid}-seats`">
        <USelect v-model="seats" :items="seatOptions" class="w-24" />
      </UFormField>
      <div class="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
        <label :for="`${uid}-website`">Website</label>
        <input :id="`${uid}-website`" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
      </div>
      <NuxtTurnstile v-if="site?.turnstileSiteKey" v-model="turnstileToken" :site-key="site.turnstileSiteKey" />
      <p v-if="errorMessage" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ errorMessage }}</p>
      <UButton type="submit" :loading="loading">{{ state.state === 'waitlist' ? 'Join the waitlist' : 'Save my place' }}</UButton>
      <p class="text-xs opacity-70">Your name and email are shared with the organiser of this event.</p>
    </form>
  </div>
</template>
