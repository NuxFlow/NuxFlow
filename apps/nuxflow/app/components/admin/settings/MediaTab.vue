<script setup lang="ts">
import type { CloudflareMediaState, R2State } from '~/types/admin-settings'

const cloudflare = defineModel<CloudflareMediaState>('cloudflare', { required: true })
const r2 = defineModel<R2State>('r2', { required: true })
defineProps<{
  saving: boolean
  onSave: () => Promise<void>
}>()
</script>

<template>
  <AdminSettingsMediaStoragePanel :saving="saving" />

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

  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-image-plus" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Image Transformations</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Resize and re-encode images on the fly via Cloudflare's <code class="font-mono">/cdn-cgi/image/</code> endpoint —
        works regardless of which storage provider above is active, and is billed separately from Cloudflare Images
        (5,000 free transformations/month, then $0.50/1,000).
      </p>
    </template>
    <div class="space-y-3">
      <UFormField label="Enable Image Transformations" description="Reserves layout space and serves smaller, modern-format images across the site.">
        <USwitch v-model="cloudflare.enableImageTransformations" />
      </UFormField>
      <UAlert
        icon="i-lucide-triangle-alert"
        color="warning"
        variant="soft"
        title="One-time setup required before enabling this"
      >
        <template #description>
          <ol class="list-decimal list-inside space-y-1 text-xs mt-1">
            <li>Cloudflare dashboard → this domain → <strong>Images → Transformations</strong> → enable it.</li>
            <li>If your media is stored anywhere other than Cloudflare Images (R2 or the database fallback), also enable
              <strong>"Resize Images from Any Origin"</strong> and allow-list this site's storage domain as a source origin.</li>
          </ol>
          Turning this on before completing those steps will make every image on the site 404.
        </template>
      </UAlert>
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

  <USeparator />

  <UAlert
    icon="i-lucide-arrow-down-up"
    color="neutral"
    variant="soft"
    description="Only one storage provider is active at a time, checked in this order: Cloudflare Images → Cloudflare R2 → the database. The first one that's set up wins. The status card at the top of this page always shows which one is in use."
  />

  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-cloud" class="w-4 h-4 text-primary-500" />
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare R2 storage</p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Cloudflare's own object storage — zero egress fees, no API keys. The <code class="font-mono">MEDIA_BUCKET</code> binding in wrangler.toml is all it needs: files are then served from this site's own address. The public URL below is <strong>optional</strong> — set it to have browsers load files straight from R2 instead.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="Public URL (optional)" hint="A custom domain connected to the bucket, or its r2.dev subdomain — enable one in the Cloudflare dashboard under R2 → your bucket → Settings. Not the S3 API endpoint.">
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
</template>
