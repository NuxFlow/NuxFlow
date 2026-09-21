<script setup lang="ts">
const downloading = ref(false)
async function downloadBackup() {
  downloading.value = true
  try {
    const res = await fetch('/api/v1/backup')
    if (!res.ok) throw new Error('Failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nuxflow-backup-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
          <UIcon name="i-lucide-database-backup" class="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <p class="font-semibold text-sm text-gray-900 dark:text-white">Download backup</p>
          <p class="text-xs text-gray-400">Export your full site as a portable JSON file</p>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <UAlert
        icon="i-lucide-info"
        color="primary"
        variant="soft"
      >
        <template #title>
          <span class="text-primary-900 dark:text-primary-200 font-semibold">What's included</span>
        </template>
        <template #description>
          <span class="text-gray-800 dark:text-gray-200">
            A self-contained .zip file with all site data and media files. Restoring it on any NuxFlow site will re-upload your images to that site's configured media provider. Limit: 100 MB of media.
          </span>
        </template>
      </UAlert>

      <div class="grid grid-cols-2 gap-3 text-sm">
        <div v-for="item in ['Content & pages', 'Categories & tags', 'Menus', 'Forms', 'Site settings', 'Content types', 'Media files', 'Themes (CSS)', 'Dynamic plugins (code)', 'Team members & roles', 'Membership tiers']" :key="item" class="flex items-center gap-2 text-gray-800 dark:text-gray-200 font-medium">
          <UIcon name="i-lucide-check" class="w-4 h-4 text-green-500 shrink-0" />
          {{ item }}
        </div>
      </div>

      <UAlert
        icon="i-lucide-shield-alert"
        color="warning"
        variant="soft"
      >
        <template #title>
          <span class="font-semibold">Contains live credentials — treat it like a password</span>
        </template>
        <template #description>
          <span class="text-gray-800 dark:text-gray-200">
            "Site settings" includes decrypted API keys and secrets (Stripe, email/AI providers, OAuth client secrets, etc.), stored in plain text inside the .zip so they can be restored on a differently-configured deployment. Store this file securely and never send it over an unencrypted channel.
          </span>
        </template>
      </UAlert>

      <UAlert icon="i-lucide-info" color="neutral" variant="soft">
        <template #title>
          <span class="font-semibold">Not included: subscriptions and API keys</span>
        </template>
        <template #description>
          <span class="text-gray-800 dark:text-gray-200">
            Membership tiers (plan definitions) are backed up, but active subscriber billing state isn't — a copied subscription row would look migrated but silently desync, since your payment provider's webhook still points at the original deployment. If you move a site with paying subscribers, update that webhook afterward. API keys can't be restored either — only their one-way hash is ever stored — regenerate them on the target site.
          </span>
        </template>
      </UAlert>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <UButton icon="i-lucide-download" :loading="downloading" @click="downloadBackup">
          Download backup
        </UButton>
      </div>
    </template>
  </UCard>
</template>
