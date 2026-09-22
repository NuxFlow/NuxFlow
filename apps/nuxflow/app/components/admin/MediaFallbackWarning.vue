<script setup lang="ts">
// Warns an admin the moment they'd notice it matters (dashboard, media library) that
// uploads are landing on the local base64-in-D1 fallback — see
// server/api/v1/media/storage-status.get.ts and getActiveProvider()'s doc comment.
// There's no onboarding-time prompt to configure real storage, so without this an
// operator can go months without knowing every page load is carrying their images as
// inline base64 text.
const { data } = await useFetch<{ provider: string, isFallback: boolean }>('/api/v1/media/storage-status')
</script>

<template>
  <UAlert
    v-if="data?.isFallback"
    icon="i-lucide-triangle-alert"
    color="warning"
    variant="soft"
    title="No media storage provider configured"
    description="Uploaded images are being stored as base64 text directly in the database and inlined into every page that uses them — this bloats page size and slows load times. Configure Cloudflare Images, R2, S3, or Bunny.net in Settings → Media."
  >
    <template #actions>
      <UButton to="/admin/settings?tab=Media" size="xs" color="warning" variant="solid">
        Go to Settings → Media
      </UButton>
    </template>
  </UAlert>
</template>
