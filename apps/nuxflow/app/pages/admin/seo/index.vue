<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const toast = useToast()

// Editors can reach this page for Redirects and the Audit; the settings tabs write
// through PATCH /api/v1/settings, which is admin-only, so they're hidden for editors.
const access = await fetchAdminAccess()
const isAdmin = computed(() => roleAtLeast(access?.role, 'admin') || Boolean(access?.isSuperAdmin))

const allTabs = [
  { key: 'global', label: 'Global defaults', icon: 'i-lucide-globe', adminOnly: true },
  { key: 'social', label: 'Social & verification', icon: 'i-lucide-share-2', adminOnly: true },
  { key: 'ai', label: 'AI & crawlers', icon: 'i-lucide-bot', adminOnly: true },
  { key: 'indexing', label: 'Indexing', icon: 'i-lucide-radar', adminOnly: true },
  { key: 'redirects', label: 'Redirects', icon: 'i-lucide-arrow-right-left', adminOnly: false },
  { key: 'audit', label: 'Audit', icon: 'i-lucide-clipboard-check', adminOnly: false },
] as const
type TabKey = typeof allTabs[number]['key']

const tabs = computed(() => allTabs.filter(t => isAdmin.value || !t.adminOnly))
const route = useRoute()
const router = useRouter()
const active = ref<TabKey>(
  (tabs.value.find(t => t.key === route.query.tab)?.key ?? tabs.value[0]!.key) as TabKey,
)
watch(active, (key) => { router.replace({ query: { ...route.query, tab: key } }) })

// ── Shared settings form (provided to the settings tabs) ─────────────────────
interface SettingsData {
  site: { id: string; name: string; domain: string }
  settings: Record<string, unknown>
}

const { data: settingsData, refresh: refreshSettings } = await useFetch<SettingsData>('/api/v1/settings', {
  immediate: isAdmin.value,
})

const form = reactive<SeoSettingsForm>(emptySeoForm())
watch(settingsData, (d) => {
  if (d) Object.assign(form, seoFormFromSettings(d.settings))
}, { immediate: true })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/v1/settings', { method: 'PATCH', body: { settings: seoFormToSettings(form) } })
    toast.add({ title: 'SEO settings saved', color: 'success' })
    await refreshSettings()
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Failed to save settings'), color: 'error' })
  } finally {
    saving.value = false
  }
}

provide(SEO_FORM_KEY, {
  form,
  saving,
  save,
  siteName: computed(() => settingsData.value?.site?.name ?? ''),
  siteDomain: computed(() => settingsData.value?.site?.domain ?? ''),
})
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">SEO</h1>

    <div class="flex flex-col md:flex-row gap-6">
      <!-- Sidebar nav -->
      <nav class="md:w-52 shrink-0 flex md:block gap-1 overflow-x-auto md:space-y-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="shrink-0 md:w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left"
          :class="active === tab.key
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'"
          @click="active = tab.key"
        >
          <UIcon :name="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </nav>

      <!-- Tab content -->
      <div class="flex-1 min-w-0 space-y-4">
        <AdminSeoGlobalTab v-if="active === 'global' && isAdmin" />
        <AdminSeoSocialTab v-else-if="active === 'social' && isAdmin" />
        <AdminSeoAiTab v-else-if="active === 'ai' && isAdmin" />
        <AdminSeoIndexingTab v-else-if="active === 'indexing' && isAdmin" />
        <AdminSeoRedirectsTab v-else-if="active === 'redirects'" />
        <AdminSeoAuditTab v-else-if="active === 'audit'" />
      </div>
    </div>
  </div>
</template>
