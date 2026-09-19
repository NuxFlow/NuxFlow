<script setup lang="ts">
// Structural theming: CSS themes can restyle fixed markup but can't replace it — a
// dynamic plugin can register a block (same registry Canvas blocks use) and be
// designated here to own the header/footer chrome instead. See app/layouts/default.vue.
const toast = useToast()

interface SettingsData {
  site: { id: string }
  settings: Record<string, unknown>
}

const { data: settingsData, refresh: refreshSettings } = await useFetch<SettingsData>('/api/v1/settings')

// Nuxt UI's <USelect>/<SelectItem> reserves the empty string internally for "no
// selection / show placeholder" and throws at runtime if an actual item uses '' as its
// value ("A <SelectItem /> must have a value prop that is not an empty string") — that
// uncaught error was breaking interactivity for the rest of this page, not just this
// select. Use a real sentinel for "built-in default" instead, and translate it to/from
// null at the settings boundary.
const DEFAULT_LAYOUT_BLOCK = '__default__'

const layout = reactive({
  headerBlockId: DEFAULT_LAYOUT_BLOCK,
  footerBlockId: DEFAULT_LAYOUT_BLOCK,
})

watch(settingsData, (d) => {
  if (!d) return
  const s = d.settings
  layout.headerBlockId = (s['layout.header_block'] as string) || DEFAULT_LAYOUT_BLOCK
  layout.footerBlockId = (s['layout.footer_block'] as string) || DEFAULT_LAYOUT_BLOCK
}, { immediate: true })

const { dynamicBlocks } = useBlockRegistry()
// Only plugin-registered blocks are offered — built-in Canvas blocks (Hero,
// Text, etc.) aren't meant for site-wide chrome.
const layoutBlockOptions = computed(() => [
  { label: 'Default (built-in)', value: DEFAULT_LAYOUT_BLOCK },
  ...dynamicBlocks().map(b => ({ label: b.name, value: b.id })),
])

const savingLayout = ref(false)

async function saveLayout() {
  savingLayout.value = true
  try {
    await $fetch('/api/v1/settings', {
      method: 'PATCH',
      body: {
        settings: {
          'layout.header_block': layout.headerBlockId === DEFAULT_LAYOUT_BLOCK ? null : layout.headerBlockId,
          'layout.footer_block': layout.footerBlockId === DEFAULT_LAYOUT_BLOCK ? null : layout.footerBlockId,
        },
      },
    })
    toast.add({ title: 'Layout regions saved', color: 'success' })
    await refreshSettings()
  } catch {
    toast.add({ title: 'Failed to save layout regions', color: 'error' })
  } finally {
    savingLayout.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Layout regions</p>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        Let a dynamic plugin replace the header/footer chrome instead of just restyling it. Only plugins that register a block appear below — see the plugin development guide (<code class="font-mono text-[10px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">plugins.md</code>) to build one.
      </p>
    </template>

    <div class="space-y-5">
      <UFormField label="Header" hint="Renders instead of the built-in site header on every public page.">
        <USelect v-model="layout.headerBlockId" :items="layoutBlockOptions" class="w-full max-w-xs" />
      </UFormField>

      <UFormField label="Footer" hint="Renders instead of the built-in site footer on every public page.">
        <USelect v-model="layout.footerBlockId" :items="layoutBlockOptions" class="w-full max-w-xs" />
      </UFormField>

      <p v-if="layoutBlockOptions.length === 1" class="text-xs text-gray-400">
        No plugins have registered a layout-capable block yet — install one to see it here.
      </p>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="savingLayout" @click="saveLayout">Save layout regions</UButton>
      </div>
    </template>
  </UCard>
</template>
