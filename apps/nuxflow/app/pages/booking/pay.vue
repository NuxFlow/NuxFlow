<script setup lang="ts">
// A place kept for someone off a paid event's waitlist. The emailed link went to their own
// address, so they can use a pass from here with no second email. Paying takes a button
// press, as on /rsvp/confirm, because mail scanners open every link.
useSeoMeta({ title: 'Book your place', robots: 'noindex,nofollow' })

interface Details {
  status: string
  title: string
  when: string
  path: string
  seats: number
  amount: number | null
  currency: string
  canPayByCard: boolean
  canUsePass: boolean
  holdExpiresAt: string | null
}

interface PayResult {
  status: string
  title: string
  when: string
  path: string
  url?: string
}

const route = useRoute()
const id = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const details = ref<Details | null>(null)
const done = ref<PayResult | null>(null)
const busy = ref<'card' | 'pass' | null>(null)
const loaded = ref(false)
const error = ref('')

const open = computed(() => Boolean(details.value?.holdExpiresAt))
const deadline = computed(() => (details.value?.holdExpiresAt ? formatLocalDateTime(details.value.holdExpiresAt) : ''))

onMounted(async () => {
  if (!id.value || !token.value) {
    loaded.value = true
    return
  }
  try {
    details.value = await $fetch<Details>('/api/public/rsvp/link', {
      method: 'POST',
      body: { action: 'describe-pay', id: id.value, token: token.value },
    })
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'This link is not valid.')
  }
  finally {
    loaded.value = true
  }
})

async function pay(method: 'card' | 'pass') {
  error.value = ''
  busy.value = method
  try {
    const result = await $fetch<PayResult>('/api/public/rsvp/link', {
      method: 'POST',
      body: { action: 'pay', id: id.value, token: token.value, method },
    })
    if (result.status === 'checkout' && result.url) {
      window.location.href = result.url
      return
    }
    done.value = result
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20 text-center space-y-4">
    <template v-if="done">
      <template v-if="done.status === 'confirmed'">
        <UIcon name="i-lucide-circle-check" class="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
        <h1 class="text-2xl font-bold">You're booked</h1>
        <p class="font-medium">{{ done.title }}</p>
        <p class="text-sm opacity-80">{{ done.when }}</p>
      </template>
      <template v-else-if="done.status === 'no_pass'">
        <UIcon name="i-lucide-circle-alert" class="w-12 h-12 text-amber-500 mx-auto" />
        <h1 class="text-2xl font-bold">We couldn't find a pass</h1>
        <p class="opacity-80">This address has no class pass with enough sessions left that's still valid on that date.</p>
        <UButton v-if="details?.canPayByCard" size="lg" @click="done = null">Back</UButton>
      </template>
      <template v-else>
        <h1 class="text-2xl font-bold">This place is no longer available</h1>
        <p class="opacity-80">The time to book it has run out.</p>
      </template>
      <UButton :to="done.path" variant="ghost">View the event</UButton>
    </template>

    <template v-else-if="!id || !token">
      <h1 class="text-2xl font-bold">Link incomplete</h1>
      <p class="opacity-80">This link is missing part of its address. Try copying the whole link from the email.</p>
    </template>

    <template v-else-if="loaded && details && !open">
      <template v-if="details.status === 'confirmed'">
        <UIcon name="i-lucide-circle-check" class="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
        <h1 class="text-2xl font-bold">You're already booked</h1>
      </template>
      <h1 v-else class="text-2xl font-bold">This place is no longer available</h1>
      <p class="font-medium">{{ details.title }}</p>
      <p class="text-sm opacity-80">{{ details.when }}</p>
      <UButton :to="details.path" variant="ghost">View the event</UButton>
    </template>

    <template v-else-if="details">
      <UIcon name="i-lucide-calendar-check" class="w-12 h-12 text-primary-500 mx-auto" />
      <h1 class="text-2xl font-bold">A place is being kept for you</h1>
      <p class="font-medium">{{ details.title }}</p>
      <p class="text-sm opacity-80">{{ details.when }}</p>
      <p class="text-sm opacity-80">{{ details.seats === 1 ? '1 place' : `${details.seats} places` }}. Book by {{ deadline }} or it goes to the next person.</p>
      <div class="flex flex-col gap-2 items-center">
        <UButton v-if="details.canPayByCard" size="lg" :loading="busy === 'card'" @click="pay('card')">
          Pay {{ formatPrice(details.amount ?? 0, details.currency) }} by card
        </UButton>
        <UButton v-if="details.canUsePass" size="lg" variant="outline" :loading="busy === 'pass'" @click="pay('pass')">
          Use my class pass
        </UButton>
      </div>
    </template>

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
  </div>
</template>
