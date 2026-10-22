<script setup lang="ts">
interface PostAddress {
  address: { siteAddress: string; platformAddress: string | null } | null
  senderEmail: string | null
}

const { run, loading: busy, toast } = useAdminAction()
const { confirm } = useConfirm()
// 403 for anyone below author — the card just doesn't render.
const { data, error, refresh } = await useFetch<PostAddress>('/api/v1/account/post-address')

async function generate(rotate: boolean) {
  if (rotate) {
    const ok = await confirm({
      title: 'Replace your posting address?',
      description: 'The current address stops working immediately. Use this if the address has been shared or leaked.',
      confirmLabel: 'Replace',
    })
    if (!ok) return
  }
  await run(async () => {
    await $fetch<unknown>('/api/v1/account/post-address', { method: 'POST' })
    await refresh()
  }, { errorTitle: "Couldn't create the address" })
}

async function disable() {
  await run(async () => {
    await $fetch<unknown>('/api/v1/account/post-address', { method: 'DELETE' })
    await refresh()
  }, { errorTitle: "Couldn't turn it off" })
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied', color: 'success' })
}
</script>

<template>
  <UCard v-if="!error && data">
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Post by email</p>
    </template>
    <div class="space-y-3 text-sm">
      <p class="text-gray-500">
        Email a private address and the message becomes a draft post: the subject is the title, the body is the content, and attached images go into the media library. Nothing is published until you review it.
      </p>
      <template v-if="data.address">
        <div class="space-y-1">
          <button class="font-mono text-sm text-primary-600 dark:text-primary-400 break-all text-left" @click="copy(data.address.siteAddress)">{{ data.address.siteAddress }}</button>
          <p v-if="data.address.platformAddress" class="text-xs text-gray-400 break-all">
            or <button class="font-mono underline decoration-dotted" @click="copy(data.address.platformAddress)">{{ data.address.platformAddress }}</button>
          </p>
        </div>
        <p class="text-xs text-gray-400">
          Only mail sent from {{ data.senderEmail }} and verified by your email provider (DKIM/DMARC) is accepted. Keep the address private.
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" variant="outline" :loading="busy" @click="generate(true)">Replace address</UButton>
          <UButton size="sm" variant="ghost" color="error" :loading="busy" @click="disable">Turn off</UButton>
        </div>
      </template>
      <UButton v-else size="sm" :loading="busy" icon="i-lucide-mail-plus" @click="generate(false)">Create my posting address</UButton>
    </div>
  </UCard>
</template>
