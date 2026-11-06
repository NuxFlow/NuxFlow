<script setup lang="ts">
// The landing page for the links in booking emails (/rsvp/confirm, /rsvp/cancel). Acting
// takes a button press (a POST), not just opening the link: mail scanners open every link in
// an email, and would otherwise take or give up places nobody meant to.

const props = defineProps<{ action: 'confirm' | 'cancel' }>()

interface LinkResult {
  status: string
  title: string
  when: string
  path: string
  payUrl?: string
}

interface CancelDetails extends LinkResult {
  terms: { refund: 'card' | 'pass' | null; tooLate: boolean; deadline: string | null }
}

const route = useRoute()
const id = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const loading = ref(false)
const error = ref('')
const done = ref<LinkResult | null>(null)
const details = ref<CancelDetails | null>(null)

const copy = computed(() => {
  if (props.action === 'confirm') {
    return { heading: 'Confirm your place', body: 'One click and it\'s done.', button: 'Yes, confirm my place', icon: 'i-lucide-calendar-check' }
  }
  const terms = details.value?.terms
  const body = terms?.refund === 'card'
    ? 'You\'ll get your money back, and your place will go to someone else if the event is full.'
    : terms?.refund === 'pass'
      ? 'The session goes back on your pass, and your place will go to someone else if the event is full.'
      : terms?.tooLate
        ? 'It\'s too late to get anything back for this booking. You can still give up your place so someone else can have it.'
        : 'Your place will go to someone else if the event is full.'
  return { heading: 'Give up your place?', body, button: 'Yes, cancel my place', icon: 'i-lucide-calendar-x' }
})

const outcome = computed(() => {
  switch (done.value?.status) {
    case 'confirmed': return { heading: 'You\'re on the list', body: 'We\'ve emailed you the details.' }
    case 'waitlist': return { heading: 'You\'re on the waitlist', body: 'This event is full at the moment. We\'ll email you if a place opens up.' }
    case 'offered': return { heading: 'We\'re keeping a place for you', body: 'It\'s yours once it\'s paid for. We\'ve emailed you this link too.' }
    case 'no_pass': return { heading: 'We couldn\'t find a pass', body: 'This address has no class pass with enough sessions left that\'s still valid on that date.' }
    case 'closed': return { heading: 'RSVPs have closed', body: 'It\'s too late to confirm a place at this event.' }
    case 'cancelled': return { heading: 'Your place is cancelled', body: details.value?.terms.refund === 'card' ? 'Thanks for letting us know. Your refund is on its way; it can take a few days to reach your account.' : details.value?.terms.refund === 'pass' ? 'Thanks for letting us know. The session is back on your pass.' : 'Thanks for letting us know.' }
    default: return { heading: 'Already done', body: '' }
  }
})

onMounted(async () => {
  if (props.action !== 'cancel' || !id.value || !token.value) return
  // Only what it costs to cancel: pressing the button still works if this can't load.
  details.value = await $fetch<CancelDetails>('/api/public/rsvp/link', {
    method: 'POST',
    body: { action: 'describe-cancel', id: id.value, token: token.value },
  }).catch(() => null)
})

async function act() {
  error.value = ''
  loading.value = true
  try {
    done.value = await $fetch<LinkResult>('/api/public/rsvp/link', {
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
      <UIcon :name="done.status === 'no_pass' ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'" class="w-12 h-12 mx-auto" :class="done.status === 'no_pass' ? 'text-amber-500' : 'text-green-600 dark:text-green-400'" />
      <h1 class="text-2xl font-bold">{{ outcome.heading }}</h1>
      <p class="font-medium">{{ done.title }}</p>
      <p v-if="done.when" class="text-sm opacity-80">{{ done.when }}</p>
      <p v-if="outcome.body" class="opacity-80">{{ outcome.body }}</p>
      <UButton v-if="done.payUrl" :href="done.payUrl" external size="lg">Book my place</UButton>
      <UButton v-if="done.status === 'no_pass'" to="/booking/passes" size="lg">Buy a class pass</UButton>
      <UButton :to="done.path" variant="ghost">View the event</UButton>
    </template>
    <template v-else-if="!id || !token">
      <h1 class="text-2xl font-bold">Link incomplete</h1>
      <p class="opacity-80">This link is missing part of its address. Try copying the whole link from the email.</p>
    </template>
    <template v-else>
      <UIcon :name="copy.icon" class="w-12 h-12 text-primary-500 mx-auto" />
      <h1 class="text-2xl font-bold">{{ copy.heading }}</h1>
      <p v-if="details" class="font-medium">{{ details.title }}</p>
      <p v-if="details?.when" class="text-sm opacity-80">{{ details.when }}</p>
      <p class="opacity-80">{{ copy.body }}</p>
      <UButton size="lg" :loading="loading" @click="act">{{ copy.button }}</UButton>
      <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
