<script setup lang="ts">
const props = defineProps<{
  modelValue: { provider: 'console' | 'cloudflare' | 'resend' | 'brevo' | 'zepto' | 'smtp' }
}>()
const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  next: []
  back: []
}>()

const local = reactive({ ...props.modelValue })
watch(local, (v) => emit('update:modelValue', { ...v }))

const providers = [
  { label: 'Cloudflare Email (recommended — no account needed)', value: 'cloudflare' },
  { label: 'Resend', value: 'resend' },
  { label: 'Brevo (Sendinblue)', value: 'brevo' },
  { label: 'ZeptoMail', value: 'zepto' },
  { label: 'MailChannels (requires an existing account)', value: 'smtp' },
  { label: 'Console (development only)', value: 'console' },
]
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Email settings</h2>
      <p class="text-sm text-gray-500 mt-1">Used for account verification, password resets, and notifications.</p>
    </div>

    <UFormField label="Email provider">
      <USelect v-model="local.provider" :items="providers" />
    </UFormField>

    <UAlert
      v-if="local.provider === 'console'"
      color="yellow"
      variant="soft"
      icon="i-lucide-triangle-alert"
      description="Console mode only prints emails to server logs. Switch to a real provider before going live."
    />

    <UAlert
      v-else-if="local.provider === 'cloudflare'"
      color="blue"
      variant="soft"
      icon="i-lucide-info"
      description="No API key needed — add a send_email binding to wrangler.toml and run `wrangler email sending enable <your-domain>` for your sending domain."
    />

    <UAlert
      v-else-if="local.provider === 'smtp'"
      color="yellow"
      variant="soft"
      icon="i-lucide-triangle-alert"
      description="MailChannels' free relay requires an existing MailChannels account and DNS domain-lockdown records — most new setups won't have this. Cloudflare Email is the zero-setup option."
    />

    <UAlert
      v-else
      color="blue"
      variant="soft"
      icon="i-lucide-info"
      description="Set your provider credentials in the environment variables or Cloudflare dashboard after setup."
    />

    <div class="flex items-center justify-between pt-2">
      <UButton variant="ghost" @click="emit('back')">
        <UIcon name="i-lucide-arrow-left" class="mr-1 w-4 h-4" />
        Back
      </UButton>
      <UButton @click="emit('next')">
        Continue
        <UIcon name="i-lucide-arrow-right" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
