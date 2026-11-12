<script setup lang="ts">
// Someone's bookings and passes, with no account: an emailed, signed link is what proves
// the address. Without one, the page offers to send it.
useSeoMeta({ title: 'My bookings and passes', robots: 'noindex,nofollow' })

interface MyList {
  bookings: Array<{ id: string; seats: number; status: string; title: string; when: string; location: string | null; cancelUrl: string; payUrl: string | null }>
  appointments: Array<{ id: string; service: string; when: string; status: string; cancelUrl: string }>
  passes: Array<{ id: string; name: string; creditsLeft: number; creditsTotal: number; expiresAt: string | null; status: string }>
}

const { data: site } = useFetch<{ turnstileSiteKey?: string | null }>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

const route = useRoute()
const linkEmail = computed(() => (typeof route.query.email === 'string' ? route.query.email : ''))
const linkExpires = computed(() => Number(route.query.expires))
const linkToken = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const hasLink = computed(() => Boolean(linkEmail.value && linkToken.value))

const list = ref<MyList | null>(null)
const listError = ref('')
const loading = ref(false)

const email = ref('')
const website = ref('')
const turnstileToken = ref('')
const sending = ref(false)
const sent = ref(false)
const sendError = ref('')

onMounted(async () => {
  if (!hasLink.value) return
  loading.value = true
  try {
    list.value = await $fetch<MyList, string>('/api/public/bookings', {
      method: 'POST',
      body: { action: 'list', email: linkEmail.value, expires: linkExpires.value, token: linkToken.value },
    })
  }
  catch (e: unknown) {
    listError.value = getErrorMessage(e, 'This link has expired. Ask for a new one below.')
  }
  finally {
    loading.value = false
  }
})

async function requestLink() {
  sendError.value = ''
  sending.value = true
  try {
    await $fetch<unknown, string>('/api/public/bookings', {
      method: 'POST',
      body: { action: 'send-link', email: email.value, website: website.value || undefined, turnstileToken: turnstileToken.value || undefined },
    })
    sent.value = true
  }
  catch (e: unknown) {
    sendError.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    sending.value = false
  }
}

const statusLabel: Record<string, string> = { confirmed: 'Booked', waitlist: 'On the waitlist', offered: 'Place kept for you', held: 'Payment in progress' }

function passDetail(pass: MyList['passes'][number]): string {
  if (pass.status === 'refunded') return 'Refunded'
  const left = `${pass.creditsLeft} of ${pass.creditsTotal} ${pass.creditsTotal === 1 ? 'session' : 'sessions'} left`
  if (!pass.expiresAt) return left
  const expired = new Date(pass.expiresAt).getTime() < Date.now()
  return `${left}. ${expired ? 'Expired' : 'Use by'} ${formatDate(pass.expiresAt)}`
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-16 space-y-8">
    <h1 class="text-2xl font-bold">My bookings and passes</h1>

    <p v-if="loading" class="opacity-70">Loading…</p>
    <UAlert v-if="listError" color="warning" variant="soft" icon="i-lucide-circle-alert" :description="listError" />

    <template v-if="list">
      <section class="space-y-3" aria-labelledby="my-bookings">
        <h2 id="my-bookings" class="font-semibold">Upcoming bookings</h2>
        <p v-if="list.bookings.length === 0" class="text-sm opacity-70">Nothing booked at the moment.</p>
        <ul class="space-y-2">
          <li v-for="booking in list.bookings" :key="booking.id" class="rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium">{{ booking.title }}</p>
              <p class="text-sm opacity-80">{{ booking.when }}<template v-if="booking.location"> · {{ booking.location }}</template></p>
              <p class="text-xs opacity-70">{{ booking.seats === 1 ? '1 place' : `${booking.seats} places` }} · {{ statusLabel[booking.status] ?? booking.status }}</p>
            </div>
            <div class="flex gap-2">
              <UButton v-if="booking.payUrl" :href="booking.payUrl" external size="sm">Book my place</UButton>
              <UButton :href="booking.cancelUrl" external size="sm" variant="outline" color="neutral">Cancel</UButton>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="list.appointments.length" class="space-y-3" aria-labelledby="my-appointments">
        <h2 id="my-appointments" class="font-semibold">Appointments</h2>
        <ul class="space-y-2">
          <li v-for="appt in list.appointments" :key="appt.id" class="rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-medium">{{ appt.service }}</p>
              <p class="text-sm opacity-80">{{ appt.when }}</p>
              <p class="text-xs opacity-70">{{ appt.status === 'confirmed' ? 'Booked' : 'Waiting for you to confirm or pay' }}</p>
            </div>
            <UButton :href="appt.cancelUrl" external size="sm" variant="outline" color="neutral">Cancel</UButton>
          </li>
        </ul>
      </section>

      <section class="space-y-3" aria-labelledby="my-passes">
        <h2 id="my-passes" class="font-semibold">Class passes</h2>
        <p v-if="list.passes.length === 0" class="text-sm opacity-70">No passes on this address.</p>
        <ul class="space-y-2">
          <li v-for="pass in list.passes" :key="pass.id" class="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p class="font-medium">{{ pass.name }}</p>
            <p class="text-sm opacity-80">{{ passDetail(pass) }}</p>
          </li>
        </ul>
        <UButton to="/booking/passes" variant="ghost" size="sm">Buy a class pass</UButton>
      </section>
    </template>

    <section v-if="!list" class="space-y-3 max-w-md" aria-labelledby="my-link">
      <h2 id="my-link" class="font-semibold">Get a link by email</h2>
      <div v-if="sent" role="status" class="text-sm">
        <p class="font-medium">Check your inbox</p>
        <p class="opacity-80">If there's anything on <strong>{{ email }}</strong>, we've sent a link to it. It works for 7 days.</p>
      </div>
      <form v-else class="space-y-3" @submit.prevent="requestLink">
        <p class="text-sm opacity-80">You don't need an account. Enter the email address you booked with.</p>
        <UFormField label="Email" name="my-email" required>
          <UInput v-model="email" type="email" required maxlength="254" autocomplete="email" class="w-full" />
        </UFormField>
        <div class="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
          <label for="my-website">Website</label>
          <input id="my-website" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
        </div>
        <NuxtTurnstile v-if="site?.turnstileSiteKey" v-model="turnstileToken" :site-key="site.turnstileSiteKey" />
        <p v-if="sendError" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ sendError }}</p>
        <UButton type="submit" :loading="sending">Email me a link</UButton>
      </form>
    </section>
  </div>
</template>
