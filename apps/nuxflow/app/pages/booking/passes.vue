<script setup lang="ts">
// Buying a class pass, no account needed: the pass belongs to the email address given here.
useSeoMeta({ title: 'Class passes', robots: 'noindex,nofollow' })

interface Pass {
  id: string
  name: string
  description: string | null
  credits: number
  price: number
  currency: string
  validDays: number | null
}

const { data: site } = useFetch<{ turnstileSiteKey?: string | null }>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

const route = useRoute()
const { user } = useUserSession()

const passes = ref<Pass[]>([])
const canBuy = ref(false)
const loaded = ref(false)
const chosenId = ref('')
const name = ref('')
const email = ref('')
const website = ref('')
const turnstileToken = ref('')
const loading = ref(false)
const error = ref('')

const chosen = computed(() => passes.value.find(p => p.id === chosenId.value) ?? null)

onMounted(async () => {
  name.value = user.value?.name ?? ''
  email.value = user.value?.email ?? ''
  try {
    const result = await $fetch<{ passes: Pass[]; canBuy: boolean }>('/api/public/class-passes')
    passes.value = result.passes
    canBuy.value = result.canBuy
    const asked = typeof route.query.buy === 'string' ? route.query.buy : ''
    chosenId.value = result.passes.some(p => p.id === asked) ? asked : ''
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'We couldn\'t load the passes. Please try again.')
  }
  finally {
    loaded.value = true
  }
})

async function buy() {
  if (!chosen.value) return
  error.value = ''
  loading.value = true
  try {
    const { url } = await $fetch<{ url: string | null }>('/api/public/class-passes', {
      method: 'POST',
      body: {
        passId: chosen.value.id,
        name: name.value,
        email: email.value,
        website: website.value || undefined,
        turnstileToken: turnstileToken.value || undefined,
      },
    })
    if (url) window.location.href = url
  }
  catch (e: unknown) {
    error.value = getErrorMessage(e, 'Something went wrong. Please try again.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-16 space-y-8">
    <div>
      <h1 class="text-2xl font-bold">Class passes</h1>
      <p class="opacity-80 mt-1">Book a block of sessions and use them when you like. No account needed.</p>
    </div>

    <p v-if="loaded && passes.length === 0 && !error" class="opacity-70">No passes are on sale at the moment.</p>
    <UAlert v-else-if="loaded && passes.length > 0 && !canBuy" color="neutral" variant="soft" icon="i-lucide-info" description="Passes can't be bought online right now. Please get in touch." />

    <div class="grid gap-4 sm:grid-cols-2">
      <button
        v-for="pass in passes"
        :key="pass.id"
        type="button"
        class="text-left rounded-2xl border p-5 transition-colors disabled:cursor-default"
        :class="chosenId === pass.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 dark:border-gray-800 hover:border-primary-500/50'"
        :disabled="!canBuy"
        :aria-pressed="chosenId === pass.id"
        @click="chosenId = pass.id"
      >
        <span class="block font-bold">{{ pass.name }}</span>
        <span class="block text-2xl font-extrabold mt-1">{{ formatPrice(pass.price, pass.currency) }}</span>
        <span class="block text-sm text-primary-600 dark:text-primary-400 mt-1">{{ pass.credits === 1 ? '1 session' : `${pass.credits} sessions` }}</span>
        <span v-if="pass.description" class="block text-sm opacity-80 mt-2">{{ pass.description }}</span>
        <span class="block text-xs opacity-60 mt-2">{{ pass.validDays ? `Valid for ${pass.validDays} days from purchase` : 'Never expires' }}</span>
      </button>
    </div>

    <form v-if="chosen && canBuy" class="space-y-3 max-w-md" @submit.prevent="buy">
      <h2 class="font-semibold">Buy {{ chosen.name }}</h2>
      <UFormField label="Your name" name="pass-name" required>
        <UInput v-model="name" required maxlength="100" autocomplete="name" class="w-full" />
      </UFormField>
      <UFormField label="Email" name="pass-email" required hint="You'll use this to book">
        <UInput v-model="email" type="email" required maxlength="254" autocomplete="email" class="w-full" />
      </UFormField>
      <div class="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
        <label for="pass-website">Website</label>
        <input id="pass-website" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
      </div>
      <NuxtTurnstile v-if="site?.turnstileSiteKey" v-model="turnstileToken" :site-key="site.turnstileSiteKey" />
      <UButton type="submit" :loading="loading">Pay {{ formatPrice(chosen.price, chosen.currency) }}</UButton>
    </form>

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
    <NuxtLink to="/booking/my" class="inline-block text-sm underline opacity-80">My bookings and passes</NuxtLink>
  </div>
</template>
