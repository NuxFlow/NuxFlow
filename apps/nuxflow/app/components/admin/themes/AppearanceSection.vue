<script setup lang="ts">
const toast = useToast()

interface SettingsData {
  site: { id: string }
  settings: Record<string, unknown>
}

const { data: settingsData, refresh: refreshSettings } = await useFetch<SettingsData>('/api/v1/settings')

const appearance = reactive({
  darkMode: 'auto' as 'auto' | 'light' | 'dark',
  primaryColor: '#00dc82',
  fontSans: 'system',
})

const darkModeOptions = [
  { label: 'Follow system preference', value: 'auto' },
  { label: 'Always light', value: 'light' },
  { label: 'Always dark', value: 'dark' },
]

const fontOptions = [
  { label: 'System default', value: 'system' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Geist', value: 'Geist' },
  { label: 'Poppins', value: 'Poppins' },
  { label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans' },
]

watch(settingsData, (d) => {
  if (!d) return
  const s = d.settings
  appearance.darkMode = ((s['theme.dark_mode'] as string) ?? 'auto') as typeof appearance.darkMode
  appearance.primaryColor = (s['theme.primary_color'] as string) ?? '#00dc82'
  appearance.fontSans = (s['theme.font_sans'] as string) ?? 'system'
}, { immediate: true })

const savingAppearance = ref(false)

async function saveAppearance() {
  savingAppearance.value = true
  try {
    await $fetch('/api/v1/settings', {
      method: 'PATCH',
      body: {
        settings: {
          'theme.dark_mode': appearance.darkMode,
          'theme.primary_color': appearance.primaryColor,
          'theme.font_sans': appearance.fontSans,
        },
      },
    })
    toast.add({ title: 'Appearance saved', color: 'success' })
    await refreshSettings()
  } catch {
    toast.add({ title: 'Failed to save appearance', color: 'error' })
  } finally {
    savingAppearance.value = false
  }
}

const swatches = [
  '#00dc82', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#14b8a6',
]
</script>

<template>
  <div class="space-y-3">
    <!-- Visual Customizer CTA -->
    <div class="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 p-5 text-white shadow-md">
      <div class="relative flex items-start justify-between gap-4">
        <div class="space-y-1.5">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-palette" class="w-5 h-5 text-violet-200" />
            <p class="text-sm font-semibold">Visual Customizer</p>
          </div>
          <p class="text-xs text-violet-100/90 max-w-sm leading-relaxed">
            No code needed — change fonts, colors, spacing, and corner shapes with a live preview of your site right next to the controls.
          </p>
        </div>
        <NuxtLink
          to="/admin/themes/customize"
          class="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-white/20 hover:bg-white/30 active:bg-white/40 px-3.5 py-2 text-xs font-semibold text-white shadow transition-colors"
        >
          Open customizer
          <UIcon name="i-lucide-arrow-right" class="w-3.5 h-3.5" />
        </NuxtLink>
      </div>
      <!-- decorative blobs -->
      <div class="pointer-events-none absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/5" />
      <div class="pointer-events-none absolute -right-2 -bottom-8 w-20 h-20 rounded-full bg-white/5" />
    </div>

    <!-- How appearance settings work -->
    <UCard>
      <div class="flex gap-3">
        <div class="shrink-0 w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
          <UIcon name="i-lucide-info" class="w-4 h-4 text-primary-500" />
        </div>
        <div class="space-y-1 text-sm">
          <p class="font-medium text-gray-900 dark:text-white">How these settings affect your site</p>
          <p class="text-gray-500 dark:text-gray-400">
            These three settings are injected into every public page as CSS — they are separate from your theme file and take effect on the next page load.
          </p>
          <ul class="mt-2 space-y-1 text-gray-500 dark:text-gray-400">
            <li><span class="font-medium text-gray-700 dark:text-gray-300">Colour scheme</span> — forces dark or light mode on the public site; <em>auto</em> follows each visitor's system preference.</li>
            <li><span class="font-medium text-gray-700 dark:text-gray-300">Accent colour</span> — injected as <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">--nuxflow-primary</code>. Use <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">var(--nuxflow-primary)</code> in your theme CSS to reference it.</li>
            <li><span class="font-medium text-gray-700 dark:text-gray-300">Body font</span> — loads the Google Font and injects it as <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">--nuxflow-font</code>, applied automatically to the page body.</li>
          </ul>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Global appearance</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Controls the visual style applied across your site</p>
      </template>

      <div class="space-y-5">
        <UFormField label="Colour scheme">
          <USelect v-model="appearance.darkMode" :items="darkModeOptions" class="w-full max-w-xs" />
        </UFormField>

        <UFormField label="Accent colour" hint="Injected as --nuxflow-primary on every public page. Reference it in your theme CSS with var(--nuxflow-primary).">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 flex-wrap">
              <button
                v-for="swatch in swatches"
                :key="swatch"
                class="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-400"
                :style="{ backgroundColor: swatch, borderColor: appearance.primaryColor === swatch ? 'currentColor' : 'transparent' }"
                :class="appearance.primaryColor === swatch ? 'ring-2 ring-offset-1 ring-primary-400' : ''"
                @click="appearance.primaryColor = swatch"
              />
            </div>
            <div class="flex items-center gap-2">
              <div
                class="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 shrink-0"
                :style="{ backgroundColor: appearance.primaryColor }"
              />
              <UInput
                v-model="appearance.primaryColor"
                placeholder="#00dc82"
                class="w-28 font-mono text-sm"
                size="sm"
              />
            </div>
          </div>
        </UFormField>

        <UFormField label="Body font">
          <USelect v-model="appearance.fontSans" :items="fontOptions" class="w-full max-w-xs" />
        </UFormField>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton :loading="savingAppearance" @click="saveAppearance">Save appearance</UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
