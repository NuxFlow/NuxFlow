<script setup lang="ts">
// Warns an admin the moment they'd notice it matters (dashboard, media library) that
// uploads are landing on the local base64-in-D1 fallback — see
// server/api/v1/media/storage-status.get.ts and getActiveProvider()'s doc comment.
// The setup wizard shows storage status too, but this is the reminder an operator sees
// day to day — without it, every page load can carry images as inline base64 for months.
const { data } = await useFetch<{ provider: string, isFallback: boolean }>('/api/v1/media/storage-status')
</script>

<template>
  <UAlert
    v-if="data?.isFallback"
    icon="i-lucide-triangle-alert"
    color="warning"
    variant="soft"
    title="No file storage connected"
    description="Uploads are being kept inside the database and inlined into every page that uses them, which makes pages heavier and slower. Connect an R2 bucket or another provider — Settings → Media shows how, and can move existing files over in one click."
  >
    <template #actions>
      <UButton to="/admin/settings?tab=Media" size="xs" color="warning" variant="solid">
        Go to Settings → Media
      </UButton>
    </template>
  </UAlert>
</template>
