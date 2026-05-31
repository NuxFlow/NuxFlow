<script setup lang="ts">
const toast = useToast()

const form = reactive({
  name: '',
  email: '',
  subject: '',
  message: '',
  turnstileToken: '',
})

const loading = ref(false)
const submitted = ref(false)

const config = useRuntimeConfig()
const hasTurnstile = computed(() => Boolean(config.public.turnstileSiteKey))

async function submit() {
  loading.value = true
  try {
    await $fetch('/api/v1/contact/submit', {
      method: 'POST',
      body: {
        name: form.name,
        email: form.email,
        subject: form.subject || undefined,
        message: form.message,
        turnstileToken: form.turnstileToken || undefined,
      },
    })
    submitted.value = true
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Could not send your message. Please try again.'
    toast.add({ title: msg, color: 'red' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-lg mx-auto">
    <div v-if="submitted" class="text-center py-12 space-y-3">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30">
        <UIcon name="i-lucide-check" class="w-6 h-6 text-green-600 dark:text-green-400" />
      </div>
      <p class="font-semibold text-gray-900 dark:text-white">Message sent!</p>
      <p class="text-sm text-gray-500">We'll get back to you as soon as possible.</p>
      <UButton variant="ghost" size="sm" @click="submitted = false; Object.assign(form, { name: '', email: '', subject: '', message: '', turnstileToken: '' })">
        Send another
      </UButton>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <UFormField label="Name" required>
        <UInput v-model="form.name" placeholder="Your name" class="w-full" required />
      </UFormField>

      <UFormField label="Email" required>
        <UInput v-model="form.email" type="email" placeholder="your@email.com" class="w-full" required />
      </UFormField>

      <UFormField label="Subject">
        <UInput v-model="form.subject" placeholder="What's this about?" class="w-full" />
      </UFormField>

      <UFormField label="Message" required>
        <UTextarea v-model="form.message" placeholder="Your message…" :rows="5" class="w-full" required />
      </UFormField>

      <NuxtTurnstile v-if="hasTurnstile" v-model="form.turnstileToken" />

      <UButton type="submit" :loading="loading" block>
        Send message
      </UButton>
    </form>
  </div>
</template>
