<script setup lang="ts">
import type { SiteSettingsResponse } from '#shared/lib/site-settings-types'
import type { ContentTypesResponse } from '#shared/lib/content-type-types'
import { APPLE_CATEGORIES, parsePodcastSettings, type PodcastSettings } from '#shared/lib/podcast'

// Settings → Podcast: the show's details for /podcast.xml (Apple Podcasts, Spotify…). One
// JSON setting, `podcast.settings`, saved on its own — a PATCH /api/v1/settings carrying only
// that key, checked by normalizePodcastSetting() — never by the shared Settings save.

const KEY = 'podcast.settings'
const { run, isRunning } = useAdminAction()
const { data, error, refresh } = await useFetch<SiteSettingsResponse>('/api/v1/settings')
const { data: typesData } = useFetch<ContentTypesResponse>('/api/v1/content-types', { server: false })

const form = reactive<PodcastSettings>(parsePodcastSettings(null))
watch(() => data.value?.settings[KEY], v => Object.assign(form, parsePodcastSettings(v)), { immediate: true })

const showCoverPicker = ref(false)
const categoryItems = APPLE_CATEGORIES.map(c => ({ label: c, value: c }))
const typeItems = computed(() => (typesData.value?.types ?? []).map(t => ({ label: t.name, value: t.slug })))
const feedUrl = computed(() => `https://${data.value?.site?.domain ?? 'your-site'}/podcast.xml`)

async function save() {
  await run(async () => {
    await $fetch<unknown>('/api/v1/settings', { method: 'PATCH', body: { settings: { [KEY]: { ...form } } } })
    await refresh()
  }, { successTitle: 'Podcast settings saved', errorTitle: 'Couldn\'t save the podcast settings', key: 'save' })
}
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-red-500">{{ getErrorMessage(error, 'Could not load the podcast settings') }}</p>
    <UCard>
      <template #header>
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-white">Podcast</p>
            <p class="mt-1 text-xs text-gray-500">
              Publish your episodes as a podcast feed that Apple Podcasts, Spotify and other apps can follow. Each episode is a post (or another content type) with an audio file, added in the editor's <strong>Podcast episode</strong> panel.
            </p>
          </div>
          <USwitch v-model="form.enabled" aria-label="Podcast on" />
        </div>
      </template>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Podcast title" class="sm:col-span-2" required>
          <UInput v-model="form.title" class="w-full" maxlength="200" />
        </UFormField>
        <UFormField label="Description" class="sm:col-span-2" hint="What listeners see in their app">
          <UTextarea v-model="form.description" :rows="3" maxlength="4000" class="w-full" />
        </UFormField>
        <UFormField label="Host or author">
          <UInput v-model="form.author" class="w-full" maxlength="200" />
        </UFormField>
        <UFormField label="Owner email" hint="Apple asks for it; most apps don't show it">
          <UInput v-model="form.ownerEmail" type="email" class="w-full" />
        </UFormField>
        <UFormField label="Category">
          <USelect v-model="form.category" :items="categoryItems" class="w-full" />
        </UFormField>
        <UFormField label="Episodes are">
          <USelect v-model="form.contentType" :items="typeItems.length ? typeItems : [{ label: 'Posts', value: 'post' }]" class="w-full" />
        </UFormField>
        <UFormField label="Cover art" class="sm:col-span-2" hint="Square, at least 1400 × 1400 pixels (JPEG or PNG)">
          <div class="flex items-center gap-3">
            <img v-if="form.coverImage" :src="form.coverImage" alt="Podcast cover" class="h-16 w-16 rounded object-cover">
            <UButton size="sm" variant="outline" icon="i-lucide-image" @click="showCoverPicker = true">{{ form.coverImage ? 'Change' : 'Choose' }}</UButton>
            <UButton v-if="form.coverImage" size="sm" variant="ghost" color="neutral" @click="form.coverImage = ''">Remove</UButton>
          </div>
        </UFormField>
        <UCheckbox v-model="form.explicit" label="Contains explicit content" class="sm:col-span-2" />
      </div>
      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-gray-500">
            Feed address to submit to Apple Podcasts and Spotify: <code class="select-all">{{ feedUrl }}</code>
          </p>
          <UButton :loading="isRunning('save')" @click="save">Save podcast settings</UButton>
        </div>
      </template>
    </UCard>

    <UModal v-model:open="showCoverPicker" title="Choose cover art">
      <template #body>
        <EditorMediaPicker @select="(f: { url: string }) => { form.coverImage = f.url; showCoverPicker = false }" />
      </template>
    </UModal>
  </div>
</template>
