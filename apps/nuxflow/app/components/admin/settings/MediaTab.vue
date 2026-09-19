<script setup lang="ts">
import type { CloudflareMediaState, R2State, S3State, BunnyState } from '~/types/admin-settings'

const cloudflare = defineModel<CloudflareMediaState>('cloudflare', { required: true })
const r2 = defineModel<R2State>('r2', { required: true })
const s3 = defineModel<S3State>('s3', { required: true })
const bunny = defineModel<BunnyState>('bunny', { required: true })
defineProps<{
  saving: boolean
  onSave: () => Promise<void>
}>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-video" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare Stream</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Adaptive-bitrate video hosting for the Videos library. Requires a Cloudflare account with Stream enabled.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="Cloudflare Account ID" hint="Found in the Cloudflare dashboard sidebar under your profile">
        <UInput v-model="cloudflare.accountId" placeholder="e.g. abc123def456..." class="font-mono" />
      </UFormField>
      <UFormField label="Stream API Token" hint="Create a token with Stream:Edit permission at dash.cloudflare.com → My Profile → API Tokens">
        <UInput v-model="cloudflare.streamToken" type="password" placeholder="••••••••" />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">
          Tokens are encrypted at rest using AES-GCM. Account ID is shared with Cloudflare Images below.
        </p>
        <UButton :loading="saving" @click="onSave">Save</UButton>
      </div>
    </template>
  </UCard>

  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-image" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare Images</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Global CDN image hosting for the Media library. When configured, images are served from Cloudflare's edge instead of stored as base64.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="Images API Token" hint="Create a token with Cloudflare Images:Edit permission">
        <UInput v-model="cloudflare.imagesToken" type="password" placeholder="••••••••" />
      </UFormField>
      <UFormField label="Images Delivery URL" hint="Your account's image delivery subdomain, e.g. https://imagedelivery.net/abc123">
        <UInput v-model="cloudflare.imagesDeliveryUrl" placeholder="https://imagedelivery.net/..." />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save</UButton>
      </div>
    </template>
  </UCard>

  <UAlert
    icon="i-lucide-info"
    color="info"
    variant="soft"
    title="How to get these credentials"
  >
    <template #description>
      <ol class="list-decimal list-inside space-y-1 text-xs mt-1">
        <li><strong>Account ID</strong> — visible in the right sidebar of any Cloudflare dashboard page.</li>
        <li><strong>Stream API Token</strong> — Cloudflare dashboard → My Profile → API Tokens → Create Token → use the "Cloudflare Stream" template.</li>
        <li><strong>Images API Token</strong> — same flow, use the "Cloudflare Images" template.</li>
        <li><strong>Images Delivery URL</strong> — Cloudflare dashboard → Images → Overview → your delivery subdomain (e.g. <code class="font-mono">https://imagedelivery.net/your-account-hash</code>).</li>
      </ol>
    </template>
  </UAlert>

  <UDivider />

  <UAlert
    icon="i-lucide-arrow-down-up"
    color="neutral"
    variant="soft"
    description="Only one image storage provider is active at a time, checked in this order: Cloudflare Images above → R2 below → S3 below that → Bunny.net below that. The first one with credentials configured wins. If none are configured, uploads fall back to storing small files directly in the database — fine for a quick test, not for real use."
  />

  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-cloud" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare R2 storage</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Cloudflare's own object storage — zero egress fees, no API keys. Requires a `MEDIA_BUCKET` R2 bucket binding in wrangler.toml (see wrangler.toml.example) and a public URL below, since R2 buckets are private by default. Used when Cloudflare Images above isn't configured.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="Public URL" hint="A custom domain connected to the bucket, or its r2.dev subdomain — enable one in the Cloudflare dashboard under R2 → your bucket → Settings">
        <UInput v-model="r2.publicUrl" placeholder="https://media.yourdomain.com" />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">No credentials to store — access is via the Worker's own bucket binding.</p>
        <UButton :loading="saving" @click="onSave">Save</UButton>
      </div>
    </template>
  </UCard>

  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-database" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">S3-compatible storage</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">AWS S3, Backblaze B2, or any S3-compatible bucket (including R2's own S3-compatible endpoint, if you'd rather use access-key auth than the native binding above). Used when Cloudflare Images and R2 above aren't configured.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="Bucket name">
        <UInput v-model="s3.bucket" placeholder="my-nuxflow-media" />
      </UFormField>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Access key ID">
          <UInput v-model="s3.accessKey" type="password" placeholder="AKIA…" class="font-mono" />
        </UFormField>
        <UFormField label="Secret access key">
          <UInput v-model="s3.secretKey" type="password" placeholder="••••••••" />
        </UFormField>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Region" hint="Default us-east-1">
          <UInput v-model="s3.region" placeholder="us-east-1" />
        </UFormField>
        <UFormField label="Endpoint" hint="Leave blank for AWS S3; required for R2/B2/other providers">
          <UInput v-model="s3.endpoint" placeholder="https://<account>.r2.cloudflarestorage.com" />
        </UFormField>
      </div>
      <UFormField label="Public URL" hint="Where uploaded files are publicly served from — your CDN or bucket's public endpoint">
        <UInput v-model="s3.publicUrl" placeholder="https://media.yourdomain.com" />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">Secret key is encrypted at rest using AES-GCM.</p>
        <UButton :loading="saving" @click="onSave">Save</UButton>
      </div>
    </template>
  </UCard>

  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-zap" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Bunny.net storage</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Bunny.net Edge Storage + CDN. Used when none of Cloudflare Images, R2, or S3 above are configured.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="API key" hint="Storage zone password, found in the Bunny.net dashboard under your storage zone → FTP & API Access">
        <UInput v-model="bunny.apiKey" type="password" placeholder="••••••••" />
      </UFormField>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Storage zone name">
          <UInput v-model="bunny.storageZone" placeholder="my-nuxflow-media" />
        </UFormField>
        <UFormField label="Pull zone subdomain" hint="Without .b-cdn.net">
          <UInput v-model="bunny.pullZone" placeholder="my-nuxflow-media" />
        </UFormField>
      </div>
    </div>
    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">API key is encrypted at rest using AES-GCM.</p>
        <UButton :loading="saving" @click="onSave">Save</UButton>
      </div>
    </template>
  </UCard>
</template>
