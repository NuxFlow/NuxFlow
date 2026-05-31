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
  settings?: { hasDemoContent?: boolean } | null
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

async function deleteTheme(theme: Theme) {
  const name = theme.name
  const id = theme.id
  const hasDemo = theme.settings?.hasDemoContent === true

  if (!confirm(`Are you sure you want to delete the theme "${name}"? This action cannot be undone.`)) {
    return
  }

  let deleteDemo = false
  if (hasDemo) {
    deleteDemo = confirm(
      `Would you also like to delete all the demo pages, menus, and forms that were imported with this theme?`
    )
  }

  deletingId.value = id
  try {
    await $fetch(`/api/v1/themes/${id}`, {
      method: 'DELETE',
      query: { deleteDemo: deleteDemo ? 'true' : 'false' }
    })
    await refresh()
    toast.add({
      title: deleteDemo ? 'Theme and demo content deleted' : 'Theme deleted (content kept)',
      color: 'green'
    })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Delete failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    deletingId.value = null
  }
}

// ── Theme upload (CSS paste or zip file) ─────────────────────────────────────

const uploadModal = ref(false)
const uploadMode = ref<'css' | 'zip'>('zip')
const uploadForm = reactive({ name: '', version: '1.0.0', css: '' })
const zipFile = ref<File | null>(null)
const uploading = ref(false)

// After zip install: show demo import offer
const demoOfferThemeId = ref<string | null>(null)
const demoOfferSummary = ref<{ pages: number; posts: number; menus: number; forms: number } | null>(null)
const importingDemo = ref(false)

function onZipFile(e: Event) {
  const input = e.target as HTMLInputElement
  zipFile.value = input.files?.[0] ?? null
}

async function uploadTheme() {
  uploading.value = true
  try {
    type UploadResult = { id: string; hasDemoContent: boolean; demoSummary: { pages: number; posts: number; menus: number; forms: number } | null }
    let result: UploadResult
    if (uploadMode.value === 'zip' && zipFile.value) {
      const fd = new FormData()
      fd.append('file', zipFile.value)
      result = await $fetch<UploadResult>('/api/v1/themes', { method: 'POST', body: fd })
    } else {
      result = await $fetch<UploadResult>('/api/v1/themes', {
        method: 'POST',
        body: { name: uploadForm.name, version: uploadForm.version, css: uploadForm.css },
      })
    }
    await refresh()
    uploadModal.value = false
    Object.assign(uploadForm, { name: '', version: '1.0.0', css: '' })
    zipFile.value = null

    if (result.hasDemoContent && result.demoSummary) {
      demoOfferThemeId.value = result.id
      demoOfferSummary.value = result.demoSummary
    } else {
      toast.add({ title: 'Theme installed', color: 'green' })
    }
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Upload failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    uploading.value = false
  }
}

async function importDemoContent(themeId: string) {
  importingDemo.value = true
  try {
    const res = await $fetch<{ result: { content: { created: number } } }>(`/api/v1/themes/${themeId}/demo-import`, {
      method: 'POST',
      body: { what: ['content', 'taxonomies', 'menus', 'forms'], conflictMode: 'archive' },
    })
    demoOfferThemeId.value = null
    demoOfferSummary.value = null
    toast.add({ title: `Demo content imported — ${res.result.content.created} pages/posts created`, color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Import failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    importingDemo.value = false
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
        <UButton size="xs" icon="i-lucide-upload" @click="uploadModal = true">Install theme</UButton>
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
              <p class="text-xs text-gray-500 dark:text-gray-400">Built-in · always available</p>
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
              <p class="text-xs text-gray-500 dark:text-gray-400">v{{ theme.version }}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
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
              <UButton
                v-if="theme.settings?.hasDemoContent"
                size="xs"
                color="blue"
                variant="soft"
                icon="i-lucide-sparkles"
                @click="importDemoContent(theme.id)"
              >
                Demo content
              </UButton>
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
                @click="deleteTheme(theme)"
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

          <div class="border-t border-gray-100 dark:border-gray-800 pt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <UIcon name="i-lucide-package-search" class="w-3.5 h-3.5 shrink-0" />
            Find community themes by searching npm for <span class="font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">nuxflow-theme</span>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Appearance settings -->
    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Appearance</h2>

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
          <p class="text-sm font-semibold">Global appearance</p>
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

    <!-- Install theme modal -->
    <UModal v-model:open="uploadModal" title="Install theme">
      <template #body>
        <div class="space-y-4 p-1">
          <!-- Mode toggle -->
          <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
            <button
              v-for="m in [{ value: 'zip', label: 'Theme package (.zip)' }, { value: 'css', label: 'CSS only' }]"
              :key="m.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              :class="uploadMode === m.value ? 'bg-white dark:bg-gray-900 shadow-sm' : 'text-gray-500'"
              @click="uploadMode = m.value as 'css' | 'zip'"
            >
              {{ m.label }}
            </button>
          </div>

          <!-- Zip upload -->
          <template v-if="uploadMode === 'zip'">
            <UAlert
              icon="i-lucide-info"
              color="blue"
              variant="soft"
              description="A theme package is a .zip file containing theme.css (required), theme.json (metadata), and optionally demo.json (starter content)."
            />
            <div
              class="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-6 py-8 hover:border-primary-400 transition-colors cursor-pointer"
              @click="($refs.zipInput as HTMLInputElement).click()"
            >
              <UIcon name="i-lucide-package" class="w-8 h-8 text-gray-400" />
              <p class="text-sm text-gray-500">
                <span v-if="zipFile" class="font-medium text-gray-900 dark:text-white">{{ zipFile.name }}</span>
                <span v-else>Click to select a .zip theme package</span>
              </p>
              <input ref="zipInput" type="file" accept=".zip" class="sr-only" @change="onZipFile">
            </div>
          </template>

          <!-- CSS paste -->
          <template v-else>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Paste CSS directly. It will be injected as an inline
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
            <UFormField label="CSS" required>
              <UTextarea
                v-model="uploadForm.css"
                :rows="10"
                placeholder=":root { --color-primary: 147 51 234; }"
                class="font-mono text-xs"
              />
            </UFormField>
          </template>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="uploadModal = false">Cancel</UButton>
            <UButton :loading="uploading" icon="i-lucide-upload" @click="uploadTheme">Install</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Demo content offer modal (shown after zip install if demo.json was present) -->
    <UModal
      :open="demoOfferThemeId !== null"
      title="Import demo content?"
      @update:open="(v) => { if (!v) { demoOfferThemeId = null; demoOfferSummary = null } }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            This theme includes starter content to help you get started quickly. You can import it now or skip and start from scratch.
          </p>
          <div v-if="demoOfferSummary" class="grid grid-cols-2 gap-2 text-sm">
            <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <UIcon name="i-lucide-file-text" class="w-4 h-4 text-primary-500" />
              {{ demoOfferSummary.pages }} page{{ demoOfferSummary.pages !== 1 ? 's' : '' }}
            </div>
            <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <UIcon name="i-lucide-pencil" class="w-4 h-4 text-primary-500" />
              {{ demoOfferSummary.posts }} post{{ demoOfferSummary.posts !== 1 ? 's' : '' }}
            </div>
            <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <UIcon name="i-lucide-navigation" class="w-4 h-4 text-primary-500" />
              {{ demoOfferSummary.menus }} menu{{ demoOfferSummary.menus !== 1 ? 's' : '' }}
            </div>
            <div class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <UIcon name="i-lucide-list-checks" class="w-4 h-4 text-primary-500" />
              {{ demoOfferSummary.forms }} form{{ demoOfferSummary.forms !== 1 ? 's' : '' }}
            </div>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 bg-blue-50/50 dark:bg-blue-950/15 p-2.5 rounded-lg border border-blue-100 dark:border-blue-900/30 flex items-start gap-2">
            <UIcon name="i-lucide-info" class="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <span><strong>Smart Archive Enabled:</strong> Conflicting pages (like an existing homepage) will be safely renamed and backed up as drafts, ensuring no data loss while the new theme imports cleanly.</span>
          </p>
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="demoOfferThemeId = null; demoOfferSummary = null">
          Skip for now
        </UButton>
        <UButton
          :loading="importingDemo"
          icon="i-lucide-sparkles"
          @click="demoOfferThemeId && importDemoContent(demoOfferThemeId)"
        >
          Import demo content
        </UButton>
      </template>
    </UModal>

    <!-- Edit CSS theme modal -->
    <UModal v-model:open="editModal" :title="`Edit CSS — ${editingTheme?.name}`">
      <template #body>
        <div class="space-y-4 p-1">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Changes take effect on the next page load. The previous CSS is replaced entirely.
          </p>

          <!-- CSS quick-reference (collapsible) -->
          <details class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
            <summary class="flex items-center gap-1.5 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 font-medium cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
              <UIcon name="i-lucide-code-2" class="w-3.5 h-3.5 shrink-0" />
              CSS reference — available tokens &amp; selectors
            </summary>
            <div class="p-3 space-y-4 bg-white dark:bg-gray-900">

              <!-- Injected variables -->
              <div>
                <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Injected from Appearance settings</p>
                <div class="font-mono space-y-0.5 text-gray-600 dark:text-gray-400">
                  <p><span class="text-primary-600 dark:text-primary-400">--nuxflow-primary</span>  <span class="text-gray-400">/* accent colour */</span></p>
                  <p><span class="text-primary-600 dark:text-primary-400">--nuxflow-font</span>     <span class="text-gray-400">/* body font stack */</span></p>
                </div>
              </div>

              <!-- Admin tokens -->
              <div>
                <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Admin dashboard tokens</p>
                <div class="font-mono space-y-0.5 text-gray-600 dark:text-gray-400">
                  <p>--glass-bg / --glass-border         <span class="text-gray-400">/* header bar */</span></p>
                  <p>--glass-xl-bg / --glass-xl-border   <span class="text-gray-400">/* sidebar */</span></p>
                  <p>--shadow-glass / --shadow-glass-hover</p>
                  <p>.mesh-bg                            <span class="text-gray-400">/* page background */</span></p>
                  <p>.nav-active                         <span class="text-gray-400">/* active nav item */</span></p>
                </div>
              </div>

              <!-- Canvas block selectors -->
              <div>
                <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Canvas block selectors (public pages)</p>
                <div class="font-mono space-y-0.5 text-gray-600 dark:text-gray-400">
                  <p>.canvas-hero         <span class="text-gray-400">/* hero / banner */</span></p>
                  <p>.canvas-features     <span class="text-gray-400">/* feature grid */</span></p>
                  <p>.canvas-image        <span class="text-gray-400">/* image block (figure inside) */</span></p>
                  <p>.canvas-text         <span class="text-gray-400">/* rich text block */</span></p>
                  <p>.canvas-columns      <span class="text-gray-400">/* multi-column layout */</span></p>
                  <p>.canvas-testimonial  <span class="text-gray-400">/* testimonial card */</span></p>
                  <p>.canvas-cta          <span class="text-gray-400">/* call-to-action banner */</span></p>
                  <p>.canvas-spacer       <span class="text-gray-400">/* vertical spacer */</span></p>
                  <p>.nux-blocks          <span class="text-gray-400">/* outer canvas wrapper */</span></p>
                  <p>.nux-content         <span class="text-gray-400">/* TipTap prose (non-Canvas) */</span></p>
                </div>
              </div>

              <p class="text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
                Full reference with examples: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">themes/default/assets/css/theme.css</code>
              </p>
            </div>
          </details>

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
