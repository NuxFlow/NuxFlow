<script setup lang="ts">
import type { AppearanceState } from '~/types/admin-settings'

const appearance = defineModel<AppearanceState>('appearance', { required: true })
const props = defineProps<{
  saving: boolean
  onSave: () => Promise<void>
}>()

const logoSizeOptions = [
  { label: 'Small (24 px)', value: 'sm' },
  { label: 'Medium (32 px)', value: 'md' },
  { label: 'Large (40 px)', value: 'lg' },
]

const { loading: uploadingLogo, run: runLogoUpload } = useAdminAction()
const { loading: uploadingFavicon, run: runFaviconUpload } = useAdminAction()

async function uploadLogo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  await runLogoUpload(async () => {
    const fd = new FormData()
    fd.append('file', file)
    const result = await $fetch<{ url: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
    appearance.value.logoUrl = result.url
    await props.onSave()
  }, { errorTitle: 'Failed to upload logo' })
  ;(e.target as HTMLInputElement).value = ''
}

async function removeLogo() {
  appearance.value.logoUrl = ''
  await props.onSave()
}

async function uploadFavicon(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  await runFaviconUpload(async () => {
    const fd = new FormData()
    fd.append('file', file)
    const result = await $fetch<{ url: string }>('/api/v1/media/upload', { method: 'POST', body: fd })
    appearance.value.faviconUrl = result.url
    await props.onSave()
  }, { errorTitle: 'Failed to upload favicon' })
  ;(e.target as HTMLInputElement).value = ''
}

async function removeFavicon() {
  appearance.value.faviconUrl = ''
  await props.onSave()
}
</script>

<template>
  <UAlert
    icon="i-lucide-palette"
    color="primary"
    variant="soft"
    title="Colour scheme, accent colour &amp; body font"
    description="These appearance settings live under Themes → Appearance alongside your active theme controls."
  >
    <template #description>
      These appearance settings live under
      <NuxtLink to="/admin/themes" class="underline font-medium">Themes → Appearance</NuxtLink>
      alongside your active theme controls.
    </template>
  </UAlert>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Site logo</p>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Shown in the header instead of the site name. Upload an SVG or PNG with a transparent background — max height 40 px looks best.</p>
    </template>
    <div class="flex items-center gap-4">
      <div class="w-32 h-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0 px-2">
        <img v-if="appearance.logoUrl" :src="appearance.logoUrl" alt="Current logo" class="max-h-10 max-w-full object-contain">
        <span v-else class="text-xs text-gray-400 dark:text-gray-500">No logo set</span>
      </div>
      <div class="space-y-2">
        <label class="cursor-pointer">
          <UButton as="span" variant="outline" icon="i-lucide-upload" :loading="uploadingLogo" size="sm">
            {{ appearance.logoUrl ? 'Replace logo' : 'Upload logo' }}
          </UButton>
          <input type="file" accept=".png,.svg,.jpg,.jpeg,.webp" class="sr-only" @change="uploadLogo">
        </label>
        <UButton
          v-if="appearance.logoUrl"
          variant="ghost"
          color="error"
          icon="i-lucide-trash-2"
          size="sm"
          @click="removeLogo"
        >
          Remove logo
        </UButton>
      </div>
    </div>
  </UCard>

  <UCard>
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Favicon</p></template>
    <div class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">The icon shown in browser tabs and bookmarks. Upload a square PNG, SVG, or ICO file — 256×256 px or larger recommended.</p>

      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
          <img v-if="appearance.faviconUrl" :src="appearance.faviconUrl" alt="Current favicon" class="w-10 h-10 object-contain">
          <img v-else src="/favicon.svg" alt="Default favicon" class="w-10 h-10 object-contain">
        </div>
        <div class="space-y-2">
          <label class="cursor-pointer">
            <UButton
              as="span"
              variant="outline"
              icon="i-lucide-upload"
              :loading="uploadingFavicon"
              size="sm"
            >
              {{ appearance.faviconUrl ? 'Replace' : 'Upload favicon' }}
            </UButton>
            <input type="file" accept=".png,.svg,.ico,.jpg,.jpeg,.webp" class="sr-only" @change="uploadFavicon">
          </label>
          <UButton
            v-if="appearance.faviconUrl"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            size="sm"
            @click="removeFavicon"
          >
            Remove custom favicon
          </UButton>
        </div>
      </div>
    </div>
  </UCard>

  <UCard>
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Frontend header</p></template>
    <div class="space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Show header bar</p>
          <p class="mt-0.5 text-xs text-gray-400">Displays the site name and navigation bar at the top of every public page.</p>
        </div>
        <USwitch v-model="appearance.showHeader" />
      </div>
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Show search icon</p>
          <p class="mt-0.5 text-xs text-gray-400">Displays a search icon in the header that links to the /search page.</p>
        </div>
        <USwitch v-model="appearance.showSearch" />
      </div>
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Sticky header</p>
          <p class="mt-0.5 text-xs text-gray-400">Keeps the header fixed at the top while scrolling. Disable to let it scroll away with the page.</p>
        </div>
        <USwitch v-model="appearance.showStickyHeader" />
      </div>
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-gray-900 dark:text-white">Logo size</p>
          <p class="mt-0.5 text-xs text-gray-400">Height of the logo image in the header. Has no effect when no logo is uploaded.</p>
        </div>
        <USelect v-model="appearance.logoSize" :items="logoSizeOptions" class="w-40" />
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Custom code</p>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Inject analytics scripts, chat widgets, or any other HTML into your public pages. Only paste code from trusted sources.</p>
    </template>
    <div class="space-y-5">
      <UFormField label="Head code" hint="Injected before </head> — use for scripts that must load early (analytics, fonts).">
        <textarea
          v-model="appearance.customHeadHtml"
          rows="5"
          placeholder="<!-- e.g. Google Analytics, Meta Pixel -->"
          class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
        />
      </UFormField>
      <UFormField label="Body code" hint="Injected before </body> — use for chat widgets or deferred scripts.">
        <textarea
          v-model="appearance.customBodyHtml"
          rows="5"
          placeholder="<!-- e.g. Intercom, Crisp, HubSpot -->"
          class="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
        />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
