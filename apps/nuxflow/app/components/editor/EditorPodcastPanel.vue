<script setup lang="ts">
import { durationSeconds } from '#shared/lib/podcast'

// A podcast episode's audio and numbers (Settings → Podcast), kept in the item's
// `settings.podcast` and saved with it. The feed (/podcast.xml) and the site-wide player
// read it (shared/lib/podcast.ts parseEpisode()).

export interface EpisodeForm {
  audioUrl: string
  duration: string
  episode: number | null
  season: number | null
  explicit: boolean
}

defineProps<{ disabled?: boolean }>()
const model = defineModel<EpisodeForm>({ required: true })
const showPicker = ref(false)
const durationProblem = computed(() => (model.value.duration && durationSeconds(model.value.duration) === null ? 'Use minutes:seconds, such as 45:10 or 1:02:03' : ''))

function setNumber(key: 'episode' | 'season', value: string | number) {
  const n = Number(value)
  model.value = { ...model.value, [key]: String(value).trim() && Number.isInteger(n) && n > 0 ? n : null }
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Podcast episode</p>
    <UFormField label="Audio file" class="text-xs" hint="MP3 or M4A from the Media Library">
      <div class="space-y-2">
        <p v-if="model.audioUrl" class="truncate text-xs text-gray-600 dark:text-gray-300" :title="model.audioUrl">{{ model.audioUrl.split('/').pop() }}</p>
        <audio v-if="model.audioUrl" :src="model.audioUrl" controls preload="none" class="w-full h-9" />
        <div class="flex gap-2">
          <UButton size="xs" variant="outline" icon="i-lucide-file-audio" :disabled="disabled" @click="showPicker = true">{{ model.audioUrl ? 'Change' : 'Choose audio' }}</UButton>
          <UButton v-if="model.audioUrl" size="xs" variant="ghost" color="neutral" :disabled="disabled" @click="model = { ...model, audioUrl: '' }">Remove</UButton>
        </div>
      </div>
    </UFormField>
    <UFormField label="Length" class="text-xs" :error="durationProblem || undefined">
      <UInput v-model="model.duration" placeholder="45:10" class="w-full text-sm" :disabled="disabled" />
    </UFormField>
    <div class="grid grid-cols-2 gap-2">
      <UFormField label="Episode" class="text-xs">
        <UInput :model-value="model.episode === null ? '' : String(model.episode)" type="number" min="1" class="w-full text-sm" :disabled="disabled" @update:model-value="setNumber('episode', $event)" />
      </UFormField>
      <UFormField label="Season" class="text-xs">
        <UInput :model-value="model.season === null ? '' : String(model.season)" type="number" min="1" class="w-full text-sm" :disabled="disabled" @update:model-value="setNumber('season', $event)" />
      </UFormField>
    </div>
    <UCheckbox v-model="model.explicit" label="Explicit" :disabled="disabled" />

    <UModal v-model:open="showPicker" title="Choose the episode's audio">
      <template #body>
        <EditorMediaPicker @select="(f: { url: string }) => { model = { ...model, audioUrl: f.url }; showPicker = false }" />
      </template>
    </UModal>
  </div>
</template>
