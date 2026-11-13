<script setup lang="ts">
// Shown on the dashboard while a starter site is waiting to be installed — typically right
// after setup, when a catalog starter was picked (its pages and images can only be added once
// the new admin is signed in). For that case the install starts by itself: the starter was
// already chosen in setup, so asking again looked like setup had silently done nothing.
// Admins only; anyone else gets a 403 and sees nothing.
import type { StartersResponse } from '#shared/lib/starters'

const { data, refresh } = await useFetch<Pick<StartersResponse, 'install'>>('/api/v1/starters', {
  query: { installOnly: '1' },
  // Not an error for editors/authors: they simply can't install starters.
  onResponseError: () => {},
})
const install = computed(() => data.value?.install ?? null)
const modalOpen = ref(false)

// Once per install per browser session: closing the window pauses it, and the banner's
// Continue button (or Starter sites) picks it up again without reopening on every visit.
const AUTO_KEY = 'nuxflow:starter-auto-install'
onMounted(() => {
  const i = install.value
  if (!i || i.mode !== 'fresh' || i.error || !['pending', 'running'].includes(i.status)) return
  try {
    if (sessionStorage.getItem(AUTO_KEY) === i.id) return
    sessionStorage.setItem(AUTO_KEY, i.id)
  }
  catch { /* storage blocked — still start it this once */ }
  modalOpen.value = true
})

// The dashboard's numbers (pages, media) were read before the install added anything.
function onClosed(isOpen: boolean) {
  if (!isOpen && !install.value) reloadNuxtApp()
}
</script>

<template>
  <!-- The dialog outlives the banner: finishing clears the pending install, and it still has
       to show "installed" afterwards. -->
  <div v-if="install || modalOpen">
    <UAlert
      v-if="install"
      color="primary"
      variant="soft"
      icon="i-lucide-layout-template"
      :title="install.mode === 'fresh' ? `Finish setting up your site with ${install.starterName}` : `${install.starterName} isn't finished installing`"
      :description="install.error ?? (install.mode === 'fresh'
        ? `Add its pages${install.imagesTotal || install.phase === 'resolve' ? ', images' : ''} and theme to your new site. It takes a minute.`
        : 'Continue where it left off, or cancel it.')"
      :actions="[{ label: install.mode === 'fresh' ? 'Install now' : 'Continue', onClick: () => { modalOpen = true } }]"
      data-testid="starter-install-banner"
    />
    <AdminStartersInstallModal v-model:open="modalOpen" :starter="null" :resume="install" @changed="refresh()" @update:open="onClosed" />
  </div>
</template>
