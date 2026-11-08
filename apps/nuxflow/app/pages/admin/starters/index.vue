<script setup lang="ts">
import type { StarterSummary } from '#shared/lib/starters'
import type { StarterInstallView } from '~/components/admin/starters/InstallModal.vue'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Starter sites' })

interface StartersResponse {
  starters: StarterSummary[]
  catalogError: string | null
  storageReady: boolean
  install: StarterInstallView | null
  applied: { id: string; name: string; at: string } | null
}

const { data, error, refresh } = await useFetch<StartersResponse>('/api/v1/starters')

const chosen = ref<StarterSummary | null>(null)
const resume = ref<StarterInstallView | null>(null)
const modalOpen = ref(false)

const categories = computed(() => ['All', ...new Set((data.value?.starters ?? []).map(s => s.category))])
const category = ref('All')
const shown = computed(() => (data.value?.starters ?? []).filter(s => category.value === 'All' || s.category === category.value))
const needsStorageCount = computed(() => (data.value?.starters ?? []).filter(s => s.needsStorage).length)

function choose(id: string) {
  chosen.value = data.value?.starters.find(s => s.id === id) ?? null
  resume.value = null
  modalOpen.value = true
}

function continueInstall() {
  chosen.value = null
  resume.value = data.value?.install ?? null
  modalOpen.value = true
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Starter sites</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Ready-made sites to start from. Switching keeps your current pages and posts as drafts, so nothing is lost.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load the starter sites')" />

    <UAlert
      v-if="data?.install"
      color="info"
      variant="soft"
      icon="i-lucide-loader"
      :title="`${data.install.starterName} isn't finished installing`"
      :description="data.install.error ?? (data.install.imagesTotal ? `${data.install.imagesDone} of ${data.install.imagesTotal} images copied so far.` : 'Continue to add its pages.')"
      :actions="[{ label: 'Continue', onClick: continueInstall }]"
    />

    <p v-if="data?.applied" class="text-sm text-gray-500 dark:text-gray-400">
      Last installed: <strong class="text-gray-700 dark:text-gray-200">{{ data.applied.name }}</strong>, {{ formatLocalDate(data.applied.at) }}.
    </p>

    <UAlert
      v-if="data && !data.storageReady && needsStorageCount"
      color="warning"
      variant="soft"
      icon="i-lucide-hard-drive"
      title="Some starter sites need file storage"
      description="Starters with images copy them into your media library, which needs R2 or Cloudflare Images. Connect one in Settings → Media to use them."
      :actions="[{ label: 'Open Settings → Media', to: '/admin/settings?tab=Media' }]"
    />

    <p v-if="data?.catalogError" class="text-sm text-gray-500 dark:text-gray-400">
      {{ data.catalogError }} The built-in starter sites are still available.
    </p>

    <div v-if="categories.length > 2" class="flex flex-wrap gap-2">
      <UButton
        v-for="c in categories"
        :key="c"
        size="sm"
        :variant="c === category ? 'solid' : 'outline'"
        :color="c === category ? 'primary' : 'neutral'"
        @click="category = c"
      >
        {{ c }}
      </UButton>
    </div>

    <StarterPicker
      v-if="data"
      :starters="shown"
      :storage-ready="data.storageReady"
      :current-id="data.applied?.id ?? null"
      action-label="Use this starter"
      :disabled="!!data.install"
      @select="choose"
    />

    <AdminStartersInstallModal v-model:open="modalOpen" :starter="chosen" :resume="resume" @changed="refresh()" />
  </div>
</template>
