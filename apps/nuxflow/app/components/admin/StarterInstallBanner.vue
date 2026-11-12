<script setup lang="ts">
// Shown on the dashboard while a starter site is waiting to be installed — typically right
// after setup, when a catalog starter was picked (its pages and images are added once the
// new admin is signed in). Admins only; anyone else gets a 403 and sees nothing.
import type { StartersResponse } from '#shared/lib/starters'

const { data } = await useFetch<Pick<StartersResponse, 'install'>>('/api/v1/starters', {
  query: { installOnly: '1' },
  // Not an error for editors/authors: they simply can't install starters.
  onResponseError: () => {},
})
const install = computed(() => data.value?.install ?? null)
</script>

<template>
  <UAlert
    v-if="install"
    color="primary"
    variant="soft"
    icon="i-lucide-layout-template"
    :title="install.mode === 'fresh' ? `Finish setting up your site with ${install.starterName}` : `${install.starterName} isn't finished installing`"
    :description="install.mode === 'fresh'
      ? `Add its pages${install.imagesTotal || install.phase === 'resolve' ? ', images' : ''} and theme to your new site. It takes a minute.`
      : 'Continue where it left off, or cancel it.'"
    :actions="[{ label: install.mode === 'fresh' ? 'Install now' : 'Continue', to: '/admin/starters' }]"
    data-testid="starter-install-banner"
  />
</template>
