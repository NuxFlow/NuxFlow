<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Platform' })

interface PlatformState {
  hostingEnabled: boolean
  primarySite: { id: string; name: string; domain: string } | null
}

const { data, error, refresh } = await useFetch<PlatformState>('/api/v1/admin/platform')
const access = useAdminAccessState()
const toast = useToast()

const saving = ref(false)
const confirmOpen = ref(false)

async function setHosting(enabled: boolean) {
  saving.value = true
  try {
    await $fetch<{ hostingEnabled: boolean }>('/api/v1/admin/platform', { method: 'PUT', body: { hostingEnabled: enabled } })
    await refresh()
    // The sidebar reads the shared access state, so Plans/Usage appear or go at once.
    if (access.value) access.value = { ...access.value, hostingPlatform: enabled }
    toast.add({ title: enabled ? 'Hosting platform turned on' : 'Hosting platform turned off', color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not change the setting'), color: 'error' })
  } finally {
    saving.value = false
    confirmOpen.value = false
  }
}

function onToggle(enabled: boolean) {
  // Turning it off lifts every site's limits, so ask first; turning it on changes
  // nothing until a site is given a plan.
  if (enabled) void setHosting(true)
  else confirmOpen.value = true
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Platform</h1>
      <p class="text-sm text-gray-500 mt-0.5">Settings for this whole NuxFlow install, not one site</p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load platform settings')" />

    <UCard v-else-if="data">
      <div class="flex items-start justify-between gap-6">
        <div class="space-y-2">
          <h2 class="font-semibold text-gray-900 dark:text-white">Run this install as a hosting platform</h2>
          <p class="text-sm text-gray-500">
            For selling sites to other people. When on, Super Admin gets <strong>Plans</strong> and <strong>Usage</strong>,
            and each site's hosting plan limits apply. When off, every site is unlimited and none of this is shown.
          </p>
          <p class="text-sm text-gray-500">
            Most installs (your own site, or a few sites you run yourself) should leave this off.
          </p>
          <p v-if="data.primarySite" class="text-xs text-gray-400">
            Stored on the primary site, {{ data.primarySite.name }} ({{ data.primarySite.domain }}).
          </p>
        </div>
        <USwitch
          :model-value="data.hostingEnabled"
          :loading="saving"
          :disabled="saving || !data.primarySite"
          aria-label="Run this install as a hosting platform"
          @update:model-value="onToggle"
        />
      </div>
      <UAlert
        v-if="!data.primarySite"
        class="mt-4"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        description="No site is marked as the primary site, so this can't be turned on. The first site created by the setup wizard is normally the primary site."
      />
    </UCard>

    <UModal v-model:open="confirmOpen" title="Turn off the hosting platform?">
      <template #body>
        <p class="text-sm text-gray-500">
          Every site goes back to unlimited: plan limits stop applying and Plans and Usage are hidden.
          Each site keeps its plan, so turning this on again puts the limits back.
        </p>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="confirmOpen = false">Cancel</UButton>
        <UButton color="warning" :loading="saving" @click="setHosting(false)">Turn off</UButton>
      </template>
    </UModal>
  </div>
</template>
