<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const auth = useAuthStore()
const toast = useToast()

const hour = new Date().getHours()
const greeting = computed(() => hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')

const { data: stats } = await useFetch<{
  publishedPages: number
  mediaFiles: number
  newSubmissions: number
  users: number
}>('/api/v1/stats')

const { data: homepageData, refresh: refreshHomepage } = await useFetch<{
  homepage: { id: string; title: string; hasCustomContent: boolean; updatedAt: string } | null
}>('/api/v1/homepage')

const homepage = computed(() => homepageData.value?.homepage ?? null)

const resettingHomepage = ref(false)

async function resetHomepage() {
  if (!confirm('Reset the homepage to the default NuxFlow template? Your custom content will be cleared.')) return
  resettingHomepage.value = true
  try {
    await $fetch('/api/v1/homepage/reset', { method: 'POST' })
    await refreshHomepage()
    toast.add({ title: 'Homepage reset to default', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Reset failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    resettingHomepage.value = false
  }
}

const statCards = computed(() => [
  {
    label: 'Published pages',
    icon: 'i-lucide-file-text',
    value: stats.value?.publishedPages ?? 0,
    iconBg: 'bg-blue-500/10 dark:bg-blue-500/15',
    iconColor: 'text-blue-500',
    to: '/admin/content',
  },
  {
    label: 'Media files',
    icon: 'i-lucide-image',
    value: stats.value?.mediaFiles ?? 0,
    iconBg: 'bg-purple-500/10 dark:bg-purple-500/15',
    iconColor: 'text-purple-500',
    to: '/admin/media',
  },
  {
    label: 'New submissions',
    icon: 'i-lucide-inbox',
    value: stats.value?.newSubmissions ?? 0,
    iconBg: 'bg-orange-500/10 dark:bg-orange-500/15',
    iconColor: 'text-orange-500',
    to: '/admin/forms',
  },
  {
    label: 'Team members',
    icon: 'i-lucide-users',
    value: stats.value?.users ?? 0,
    iconBg: 'bg-green-500/10 dark:bg-green-500/15',
    iconColor: 'text-green-500',
    to: '/admin/users',
  },
])
</script>

<template>
  <div class="space-y-6">
    <!-- Greeting -->
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
        {{ greeting }}, {{ auth.user?.name?.split(' ')[0] }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Here's what's happening on your site.</p>
    </div>

    <!-- Stat cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <NuxtLink
        v-for="stat in statCards"
        :key="stat.label"
        :to="stat.to"
        class="block"
      >
        <div class="glass glass-hover rounded-2xl p-4 flex items-center gap-3 cursor-pointer transition-all duration-200 hover:-translate-y-0.5">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :class="stat.iconBg">
            <UIcon :name="stat.icon" class="w-5 h-5" :class="stat.iconColor" />
          </div>
          <div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white leading-none">{{ stat.value.toLocaleString() }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ stat.label }}</p>
          </div>
        </div>
      </NuxtLink>
    </div>

    <!-- Homepage card -->
    <div v-if="homepage">
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Homepage</h2>
      <div class="glass rounded-2xl p-4 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-home" class="w-5 h-5 text-primary-500" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ homepage.title }}</p>
            <p class="text-xs text-gray-400 mt-0.5">
              <span v-if="homepage.hasCustomContent">Custom content · </span>
              <span v-else>Showing NuxFlow default template · </span>
              <a href="/" target="_blank" rel="noopener" class="text-primary-500 hover:underline">View site ↗</a>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <UButton
            v-if="homepage.hasCustomContent"
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-ccw"
            :loading="resettingHomepage"
            @click="resetHomepage"
          >
            Reset
          </UButton>
          <UButton
            :to="`/admin/content/${homepage.id}`"
            size="xs"
            icon="i-lucide-pencil"
          >
            Edit homepage
          </UButton>
        </div>
      </div>
    </div>

    <!-- Quick actions -->
    <div>
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick actions</h2>
      <div class="flex flex-wrap gap-3">
        <UButton to="/admin/content/new" icon="i-lucide-plus">New page</UButton>
        <UButton to="/admin/media" variant="outline" icon="i-lucide-upload">Upload media</UButton>
        <UButton to="/admin/forms/new" variant="outline" icon="i-lucide-list-plus">New form</UButton>
        <UButton to="/admin/settings" variant="outline" icon="i-lucide-settings">Settings</UButton>
      </div>
    </div>
  </div>
</template>
