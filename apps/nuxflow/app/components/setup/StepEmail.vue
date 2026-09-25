<script setup lang="ts">
const props = defineProps<{
  modelValue: { provider: 'console' | 'cloudflare' | 'resend' | 'brevo' | 'zepto' }
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
      v-if="local.provider === 'cloudflare'"
      color="info"
      variant="soft"
      icon="i-lucide-info"
      description="No API key needed. Run `wrangler email sending enable <your-domain>` once (or onboard the domain under Email Service in the Cloudflare dashboard) for the domain your From address uses. Until then Cloudflare only delivers to verified addresses in your own account, so password resets and invites to anyone else won't arrive. Cloudflare Email is for transactional mail only — no newsletters or bulk sends."
    />


    <UAlert
      v-else
      color="info"
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
