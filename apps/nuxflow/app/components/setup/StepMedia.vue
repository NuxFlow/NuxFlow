<script setup lang="ts">
const props = defineProps<{
  modelValue: {
    provider: 'local' | 'cloudflare' | 's3' | 'bunny'
    cloudflareToken?: string
    cloudflareAccountId?: string
    s3Bucket?: string
    s3Region?: string
    s3AccessKey?: string
    s3SecretKey?: string
    bunnyApiKey?: string
    bunnyStorageZone?: string
  }
}>()
const emit = defineEmits<{ 'update:modelValue': [v: typeof props.modelValue] }>()

const local = reactive({ ...props.modelValue })
watch(local, (v) => emit('update:modelValue', { ...v }))

const providers = [
  { value: 'local', label: 'Local (dev only)', icon: 'i-lucide-hard-drive', description: 'Stores files in base64. For development only — not suitable for production.' },
  { value: 'cloudflare', label: 'Cloudflare Images', icon: 'i-simple-icons-cloudflare', description: 'Global CDN with image resizing and optimization.' },
  { value: 's3', label: 'S3-compatible', icon: 'i-simple-icons-amazons3', description: 'Works with AWS S3, Backblaze B2, Cloudflare R2, and more.' },
  { value: 'bunny', label: 'Bunny.net', icon: 'i-lucide-rabbit', description: 'Affordable CDN with edge storage and video streaming.' },
]
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Media storage</h3>
      <p class="text-sm text-gray-500 mt-1">Choose where uploaded files are stored and served from.</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <button
        v-for="p in providers"
        :key="p.value"
        class="text-left p-3 rounded-xl border-2 transition-colors"
        :class="local.provider === p.value
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
        @click="local.provider = p.value as typeof local.provider"
      >
        <div class="flex items-center gap-2 mb-1">
          <UIcon :name="p.icon" class="w-4 h-4 text-primary-500" />
          <span class="text-sm font-medium text-gray-900 dark:text-white">{{ p.label }}</span>
        </div>
        <p class="text-xs text-gray-500">{{ p.description }}</p>
      </button>
    </div>

    <!-- Cloudflare Images -->
    <template v-if="local.provider === 'cloudflare'">
      <UFormField label="Images API Token">
        <UInput v-model="local.cloudflareToken" type="password" placeholder="..." />
      </UFormField>
      <UFormField label="Account ID">
        <UInput v-model="local.cloudflareAccountId" placeholder="abc123..." />
      </UFormField>
    </template>

    <!-- S3 -->
    <template v-if="local.provider === 's3'">
      <UFormField label="Bucket name">
        <UInput v-model="local.s3Bucket" placeholder="my-bucket" />
      </UFormField>
      <UFormField label="Region">
        <UInput v-model="local.s3Region" placeholder="us-east-1" />
      </UFormField>
      <UFormField label="Access key ID">
        <UInput v-model="local.s3AccessKey" placeholder="AKIA..." />
      </UFormField>
      <UFormField label="Secret access key">
        <UInput v-model="local.s3SecretKey" type="password" placeholder="..." />
      </UFormField>
    </template>

    <!-- Bunny -->
    <template v-if="local.provider === 'bunny'">
      <UFormField label="API key">
        <UInput v-model="local.bunnyApiKey" type="password" placeholder="..." />
      </UFormField>
      <UFormField label="Storage zone">
        <UInput v-model="local.bunnyStorageZone" placeholder="my-zone" />
      </UFormField>
    </template>
  </div>
</template>
