<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const toast = useToast()

// ── Theme list ────────────────────────────────────────────────────────────────

interface Theme {
  id: string
  name: string
  packageName: string
  version: string
  isActive: boolean
  hasCss: boolean
}

const { data, refresh } = await useFetch<{ themes: Theme[] }>('/api/v1/themes')
const installedThemes = computed(() => data.value?.themes ?? [])
const anyDbThemeActive = computed(() => installedThemes.value.some(t => t.isActive))
const defaultIsActive = computed(() => !anyDbThemeActive.value)

const activatingId = ref<string | null>(null)
const previewingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const resetting = ref(false)

async function activate(id: string) {
  activatingId.value = id
  try {
    await $fetch(`/api/v1/themes/${id}/activate`, { method: 'POST' })
    await refresh()
    toast.add({ title: 'Theme activated', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to activate theme', color: 'red' })
  } finally {
    activatingId.value = null
  }
}

async function preview(id: string) {
  previewingId.value = id
  try {
    const result = await $fetch<{ previewUrl: string }>(`/api/v1/themes/${id}/preview`, { method: 'POST' })
    window.open(result.previewUrl, '_blank', 'noopener')
  } catch {
    toast.add({ title: 'Failed to generate preview', color: 'red' })
  } finally {
    previewingId.value = null
  }
}

async function resetToDefault() {
  resetting.value = true
  try {
    await $fetch('/api/v1/themes/reset', { method: 'POST' })
    await refresh()
    toast.add({ title: 'Reverted to default theme', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to reset theme', color: 'red' })
  } finally {
    resetting.value = false
  }
}

async function deleteTheme(id: string, name: string) {
  if (!confirm(`Delete "${name}"? This will permanently remove the CSS and cannot be undone.`)) return
  deletingId.value = id
  try {
    await $fetch(`/api/v1/themes/${id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Theme deleted', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Delete failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    deletingId.value = null
  }
}

// ── CSS theme upload ──────────────────────────────────────────────────────────

const uploadModal = ref(false)
const uploadForm = reactive({ name: '', version: '1.0.0', css: '' })
const uploading = ref(false)

async function uploadTheme() {
  uploading.value = true
  try {
    await $fetch('/api/v1/themes', {
      method: 'POST',
      body: { name: uploadForm.name, version: uploadForm.version, css: uploadForm.css },
    })
    await refresh()
    uploadModal.value = false
    Object.assign(uploadForm, { name: '', version: '1.0.0', css: '' })
    toast.add({ title: 'CSS theme uploaded and activated', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Upload failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    uploading.value = false
  }
}

// ── CSS theme editor ──────────────────────────────────────────────────────────

const editModal = ref(false)
const editingTheme = ref<Theme | null>(null)
const editCss = ref('')
const saving = ref(false)

function openEdit(theme: Theme) {
  editingTheme.value = theme
  editCss.value = ''
  editModal.value = true
}

async function saveCSS() {
  if (!editingTheme.value) return
  saving.value = true
  try {
    await $fetch(`/api/v1/themes/${editingTheme.value.id}/css`, {
      method: 'PATCH',
      body: { css: editCss.value },
    })
    toast.add({ title: 'CSS updated — active on next page load', color: 'green' })
    editModal.value = false
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Save failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    saving.value = false
  }
}

// ── Appearance ────────────────────────────────────────────────────────────────

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
    toast.add({ title: 'Appearance saved', color: 'green' })
    await refreshSettings()
  } catch {
    toast.add({ title: 'Failed to save appearance', color: 'red' })
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
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Themes</h1>

    <!-- Installed themes -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Installed themes</h2>
        <UButton size="xs" icon="i-lucide-upload" @click="uploadModal = true">Upload CSS theme</UButton>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <!-- Built-in default — always shown, no DB row needed -->
        <UCard>
          <div class="aspect-video rounded-lg overflow-hidden mb-3 bg-gradient-to-br from-emerald-400 via-teal-300 to-cyan-400 flex items-center justify-center relative">
            <div class="absolute inset-0 bg-black/10" />
            <div class="relative text-center">
              <div class="w-8 h-8 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center mx-auto mb-1.5">
                <UIcon name="i-lucide-layers" class="w-4 h-4 text-white" />
              </div>
              <span class="text-white font-bold text-sm drop-shadow">NuxFlow Default</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium text-gray-900 dark:text-white text-sm">Default</p>
              <p class="text-xs text-gray-400">Built-in · always available</p>
            </div>
            <UBadge v-if="defaultIsActive" color="green" variant="soft" size="xs">Active</UBadge>
            <UButton
              v-else
              size="xs"
              variant="outline"
              :loading="resetting"
              @click="resetToDefault"
            >
              Use default
            </UButton>
          </div>
        </UCard>

        <!-- Themes from DB -->
        <UCard v-for="theme in installedThemes" :key="theme.id">
          <div
            class="aspect-video rounded-lg flex items-center justify-center mb-3 relative overflow-hidden"
            :class="theme.hasCss
              ? 'bg-gradient-to-br from-violet-500/20 to-indigo-500/20 dark:from-violet-900/40 dark:to-indigo-900/40'
              : 'bg-gradient-to-br from-primary-50 to-white dark:from-gray-800 dark:to-gray-900'"
          >
            <UIcon
              :name="theme.hasCss ? 'i-lucide-paintbrush' : 'i-lucide-layout-template'"
              class="w-8 h-8 opacity-30"
            />
            <UBadge
              color="blue"
              variant="soft"
              size="xs"
              class="absolute top-2 right-2"
            >
              {{ theme.hasCss ? 'CSS' : 'Bundled' }}
            </UBadge>
          </div>
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium text-gray-900 dark:text-white text-sm truncate">{{ theme.name }}</p>
              <p class="text-xs text-gray-400">v{{ theme.version }}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <UButton
                v-if="theme.hasCss"
                size="xs"
                variant="ghost"
                icon="i-lucide-pencil"
                title="Edit CSS"
                @click="openEdit(theme)"
              />
              <UButton
                v-if="!theme.hasCss"
                size="xs"
                variant="ghost"
                icon="i-lucide-eye"
                :loading="previewingId === theme.id"
                title="Preview"
                @click="preview(theme.id)"
              />
              <UBadge v-if="theme.isActive" color="green" variant="soft" size="xs">Active</UBadge>
              <UButton
                v-else
                size="xs"
                variant="outline"
                :loading="activatingId === theme.id"
                @click="activate(theme.id)"
              >
                Activate
              </UButton>
              <UButton
                v-if="theme.hasCss"
                size="xs"
                color="red"
                variant="ghost"
                icon="i-lucide-trash-2"
                :loading="deletingId === theme.id"
                @click="deleteTheme(theme.id, theme.name)"
              />
            </div>
          </div>
        </UCard>
      </div>

      <!-- How to add themes -->
      <UCard>
        <div class="space-y-4">
          <div class="flex gap-3">
            <div class="shrink-0 w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <UIcon name="i-lucide-info" class="w-4 h-4 text-primary-500" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white">Two ways to theme your site</p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                <strong>CSS themes</strong> — upload a stylesheet and it takes effect immediately, no redeploy needed. Ideal for colour palettes, typography, and spacing.
                <strong>Bundled themes</strong> — installed via the CLI and deployed, required for layout or component changes.
              </p>
            </div>
          </div>

          <div class="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">To install a bundled theme from npm:</p>
            <div class="flex items-start gap-2">
              <UBadge color="neutral" variant="soft" size="xs" class="mt-0.5 shrink-0 font-mono">1</UBadge>
              <div class="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-2.5 font-mono text-xs text-green-400 flex-1">
                npx nuxflow add @author/theme-name
              </div>
            </div>
            <div class="flex items-start gap-2">
              <UBadge color="neutral" variant="soft" size="xs" class="mt-0.5 shrink-0 font-mono">2</UBadge>
              <div class="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-2.5 font-mono text-xs text-green-400 flex-1">
                pnpm build &amp;&amp; wrangler deploy
              </div>
            </div>
            <div class="flex items-start gap-2">
              <UBadge color="neutral" variant="soft" size="xs" class="mt-0.5 shrink-0 font-mono">3</UBadge>
              <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Return here and click <strong>Activate</strong>.</p>
            </div>
          </div>

          <div class="border-t border-gray-100 dark:border-gray-800 pt-3 flex items-center gap-2 text-xs text-gray-400">
            <UIcon name="i-lucide-package-search" class="w-3.5 h-3.5 shrink-0" />
            Find community themes by searching npm for <span class="font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">nuxflow-theme</span>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Appearance settings -->
    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Appearance</h2>

      <UCard>
        <template #header>
          <p class="text-sm font-semibold">Global appearance</p>
          <p class="text-xs text-gray-400 mt-0.5">Controls the visual style applied across your site</p>
        </template>

        <div class="space-y-5">
          <UFormField label="Colour scheme">
            <USelect v-model="appearance.darkMode" :items="darkModeOptions" class="w-full max-w-xs" />
          </UFormField>

          <UFormField label="Accent colour" hint="Used for buttons, links, and highlights">
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

    <!-- Upload CSS theme modal -->
    <UModal v-model:open="uploadModal" title="Upload CSS theme">
      <template #body>
        <div class="space-y-4 p-1">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Paste your CSS below. It will be injected into every public page as an inline
            <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">&lt;style&gt;</code>
            block — no redeploy required.
          </p>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Theme name" required>
              <UInput v-model="uploadForm.name" placeholder="My Theme" />
            </UFormField>
            <UFormField label="Version">
              <UInput v-model="uploadForm.version" placeholder="1.0.0" class="font-mono" />
            </UFormField>
          </div>

          <UFormField label="CSS" required hint="Custom properties, font imports, selector overrides">
            <UTextarea
              v-model="uploadForm.css"
              :rows="12"
              placeholder=":root {
  --color-primary: 147 51 234;
  --font-sans: 'Inter', sans-serif;
}

body {
  font-family: var(--font-sans);
}"
              class="font-mono text-xs"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="uploadModal = false">Cancel</UButton>
            <UButton :loading="uploading" icon="i-lucide-upload" @click="uploadTheme">Upload &amp; activate</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Edit CSS theme modal -->
    <UModal v-model:open="editModal" :title="`Edit CSS — ${editingTheme?.name}`">
      <template #body>
        <div class="space-y-4 p-1">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Changes take effect on the next page load. The previous CSS is replaced entirely.
          </p>

          <UFormField label="CSS" required>
            <UTextarea
              v-model="editCss"
              :rows="14"
              placeholder="Paste updated CSS here…"
              class="font-mono text-xs"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="editModal = false">Cancel</UButton>
            <UButton :loading="saving" icon="i-lucide-save" @click="saveCSS">Save CSS</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
