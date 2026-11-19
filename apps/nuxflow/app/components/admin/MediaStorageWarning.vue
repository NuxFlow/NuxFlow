<script setup lang="ts">
// Tells an admin (dashboard, media library) that the site has no file storage, so every
// image and file upload is refused — see server/api/v1/media/storage-status.get.ts and
// getActiveProvider(). The setup wizard and checklist say it too; this is the day-to-day one.
const { data } = await useFetch<{ provider: string | null, hasStorage: boolean }>('/api/v1/media/storage-status')
</script>

<template>
  <UAlert
    v-if="data && !data.hasStorage"
    icon="i-lucide-triangle-alert"
    color="error"
    variant="soft"
    title="No file storage connected"
    description="Images and files can't be uploaded until this site has file storage. Add an R2 bucket (the MEDIA_BUCKET binding in wrangler.toml) and redeploy — there's nothing to fill in afterwards."
  >
    <template #actions>
      <UButton to="/admin/settings?tab=Media" size="xs" color="error" variant="solid">
        Go to Settings → Media
      </UButton>
    </template>
  </UAlert>
</template>
