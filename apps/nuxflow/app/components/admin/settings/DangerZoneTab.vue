<script setup lang="ts">
const props = defineProps<{
  siteId: string
  siteName: string
}>()

const auth = useAuthStore()
const toast = useToast()

const deleteConfirm = ref('')
const deleting = ref(false)
const siteDeleted = ref(false)
const deletedWasLastSite = ref(false)
const deleteCountdown = ref(3)

// Every site sharing this deployment — fetched lazily the first time the tab
// is opened. "Main" is simply the oldest site (no separate flag for it); the
// server applies the exact same rule, this is only for showing the blocking
// message up front instead of making the admin click delete to find out.
interface SiteRow { id: string; name: string; domain: string; createdAt: string }
const allSites = ref<SiteRow[]>([])
const loadingAllSites = ref(false)
const allSitesLoaded = ref(false)

async function loadAllSites() {
  if (allSitesLoaded.value || loadingAllSites.value) return
  loadingAllSites.value = true
  try {
    const res = await $fetch<{ sites: SiteRow[] }>('/api/v1/admin/sites')
    allSites.value = res.sites
    allSitesLoaded.value = true
  } catch {
    // Not a cross-site super admin, or the call failed — fall back to the
    // plain single-site delete flow; the server enforces the real rule anyway.
    allSitesLoaded.value = true
  } finally {
    loadingAllSites.value = false
  }
}

onMounted(() => loadAllSites())

const sortedSites = computed(() => [...allSites.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))

const isMainSite = computed(() => {
  if (allSites.value.length === 0) return false
  return sortedSites.value[0]?.id === props.siteId
})

const blockingSites = computed(() => allSites.value.filter(s => s.id !== props.siteId))

async function deleteSite() {
  if (deleteConfirm.value !== props.siteName) return
  deleting.value = true
  try {
    const res = await $fetch<{ id: string; wasLastSite: boolean; failedMediaDeletes: string[] }>('/api/v1/settings', { method: 'DELETE' })
    siteDeleted.value = true
    deletedWasLastSite.value = res.wasLastSite
    toast.add({ title: 'Site deleted — you will be signed out shortly', color: 'success' })
    if (res.failedMediaDeletes.length > 0) {
      toast.add({
        title: `${res.failedMediaDeletes.length} media file(s) could not be removed from storage`,
        description: 'The site\'s records are gone, but some files may still exist with your media provider — check it directly.',
        color: 'warning',
      })
    }

    // The domain this site lived on no longer has any site at all — a session
    // cookie here is meaningless either way, so always sign out. Deliberately
    // NOT using auth.signOut() (which redirects straight to /login) — a
    // wasLastSite delete needs to land on /setup instead, so this counts down
    // first and picks the right destination once it fires.
    const interval = setInterval(async () => {
      deleteCountdown.value--
      if (deleteCountdown.value <= 0) {
        clearInterval(interval)
        await auth.signOutSilently()
        await navigateTo(res.wasLastSite ? '/setup' : '/login', { external: true })
      }
    }, 1000)
  } catch (err: unknown) {
    const errMsg = (err as { data?: { message?: string } })?.data?.message ?? 'Failed to delete site.'
    toast.add({ title: errMsg, color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UCard class="border border-red-200 dark:border-red-900">
    <template #header>
      <p class="text-sm font-semibold text-red-600 dark:text-red-400">Delete site</p>
    </template>
    <!-- Deleted: site and all its data are gone -->
    <div v-if="siteDeleted" class="space-y-3">
      <p v-if="deletedWasLastSite" class="text-sm text-gray-600 dark:text-gray-400">
        This site and all its content, media, users, and settings have been deleted. You're being signed out in {{ deleteCountdown }}… and taken to setup to start fresh.
      </p>
      <p v-else class="text-sm text-gray-600 dark:text-gray-400">
        This site and all its content, media, users, and settings have been deleted. This domain no longer has a site, so you're being signed out in {{ deleteCountdown }}… To manage another site, visit its domain directly and sign in there. To re-provision this domain, create it again from Super Admin → Sites on another site you manage.
      </p>
    </div>

    <!-- Blocked: this is the main site and other sites still exist -->
    <div v-else-if="isMainSite && blockingSites.length > 0" class="space-y-3">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        This is the main site for this deployment — delete the other site{{ blockingSites.length === 1 ? '' : 's' }} below first before this one can be deleted.
      </p>
      <ul class="space-y-1.5">
        <li v-for="s in blockingSites" :key="s.id" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <UIcon name="i-lucide-globe" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span>{{ s.name }}</span>
          <span class="font-mono text-xs text-gray-400">{{ s.domain }}</span>
        </li>
      </ul>
    </div>

    <!-- Normal delete flow -->
    <div v-else class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Permanently deletes this site and all its content, media, users, and settings. This action cannot be undone.
      </p>
      <UFormField :label="`Type &quot;${siteName}&quot; to confirm`" class="w-full">
        <UInput v-model="deleteConfirm" :placeholder="siteName" class="w-full" />
      </UFormField>
      <div class="flex items-center justify-between pt-2">
        <p class="text-xs text-gray-400">
          <span v-if="deleteConfirm && deleteConfirm !== siteName" class="text-red-400">Name does not match.</span>
          <span v-else-if="deleteConfirm === siteName && deleteConfirm" class="text-green-500">Name confirmed — you can now delete.</span>
          <span v-else>The button below will activate once the name matches.</span>
        </p>
        <UButton
          color="error"
          :loading="deleting"
          :disabled="deleteConfirm !== siteName"
          @click="deleteSite"
        >
          Delete this site
        </UButton>
      </div>
    </div>
  </UCard>
</template>
