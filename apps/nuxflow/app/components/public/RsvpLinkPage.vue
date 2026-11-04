<script setup lang="ts">
// The landing page for the links in RSVP emails (/rsvp/confirm, /rsvp/cancel). Acting takes
// a button press (a POST), not just opening the link: mail scanners open every link in an
// email, and would otherwise take or give up places nobody meant to.

const props = defineProps<{ action: 'confirm' | 'cancel' }>()

const route = useRoute()
const id = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const loading = ref(false)
const error = ref('')
const done = ref<{ status: string; title: string; when: string; path: string } | null>(null)

const copy = computed(() => props.action === 'confirm'
  ? { heading: 'Confirm your place', body: 'One click and it\'s done.', button: 'Yes, confirm my place', icon: 'i-lucide-calendar-check' }
  : { heading: 'Give up your place?', body: 'Your place will go to someone else if the event is full.', button: 'Yes, cancel my place', icon: 'i-lucide-calendar-x' })

const outcome = computed(() => {
  switch (done.value?.status) {
    case 'confirmed': return { heading: 'You\'re on the list', body: 'We\'ve emailed you the details.' }
    case 'waitlist': return { heading: 'You\'re on the waitlist', body: 'This event is full at the moment. We\'ll email you if a place opens up.' }
    case 'closed': return { heading: 'RSVPs have closed', body: 'It\'s too late to confirm a place at this event.' }
    case 'cancelled': return { heading: 'Your place is cancelled', body: 'Thanks for letting us know.' }
    default: return { heading: 'Already done', body: '' }
  }
})

async function act() {
  error.value = ''
  loading.value = true
  try {
    done.value = await $fetch<{ status: string; title: string; when: string; path: string }>('/api/public/rsvp/link', {
      method: 'POST',
      body: { action: props.action, id: id.value, token: token.value },
    })
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'This link is not valid.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20 text-center space-y-4">
    <template v-if="done">
      <UIcon name="i-lucide-circle-check" class="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
      <h1 class="text-2xl font-bold">{{ outcome.heading }}</h1>
      <p class="font-medium">{{ done.title }}</p>
      <p v-if="done.when" class="text-sm opacity-80">{{ done.when }}</p>
      <p v-if="outcome.body" class="opacity-80">{{ outcome.body }}</p>
      <UButton :to="done.path" variant="ghost">View the event</UButton>
    </template>
    <template v-else-if="!id || !token">
      <h1 class="text-2xl font-bold">Link incomplete</h1>
      <p class="opacity-80">This link is missing part of its address. Try copying the whole link from the email.</p>
    </template>
    <template v-else>
      <UIcon :name="copy.icon" class="w-12 h-12 text-primary-500 mx-auto" />
      <h1 class="text-2xl font-bold">{{ copy.heading }}</h1>
      <p class="opacity-80">{{ copy.body }}</p>
      <UButton size="lg" :loading="loading" @click="act">{{ copy.button }}</UButton>
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
