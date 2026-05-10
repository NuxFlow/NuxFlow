<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ toggleCollapse: [] }>()

const auth = useAuthStore()
const route = useRoute()

const coreNav = [
  { label: 'Dashboard', to: '/admin', icon: 'i-lucide-layout-dashboard' },
  { label: 'Content', to: '/admin/content', icon: 'i-lucide-file-text' },
  { label: 'Navigation', to: '/admin/menus', icon: 'i-lucide-navigation' },
  { label: 'Media', to: '/admin/media', icon: 'i-lucide-image' },
  { label: 'Forms', to: '/admin/forms', icon: 'i-lucide-list-checks' },
  { label: 'Users', to: '/admin/users', icon: 'i-lucide-users' },
  { label: 'Themes', to: '/admin/themes', icon: 'i-lucide-palette' },
  { label: 'Plugins', to: '/admin/plugins', icon: 'i-lucide-puzzle' },
  { label: 'SEO', to: '/admin/seo', icon: 'i-lucide-search' },
  { label: 'Settings', to: '/admin/settings', icon: 'i-lucide-settings' },
]

const { data } = useFetch('/api/v1/plugins/nav', { key: 'plugin-nav' })
const pluginNav = computed(() => data.value?.navItems ?? [])

function isActive(to: string) {
  return route.path === to || (to !== '/admin' && route.path.startsWith(to))
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Logo + collapse toggle -->
    <div
      class="h-16 flex items-center shrink-0 gap-2"
      :class="collapsed ? 'px-2' : 'px-5'"
      style="border-bottom: 1px solid var(--glass-xl-border);"
    >
      <div class="flex items-center gap-2.5 flex-1 min-w-0">
        <div class="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center shadow-md shadow-primary-500/30 shrink-0">
          <UIcon name="i-lucide-layers" class="w-4 h-4 text-white" />
        </div>
        <span v-if="!collapsed" class="font-bold text-gray-900 dark:text-white tracking-tight">NuxFlow</span>
      </div>
      <button
        class="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
        :class="{ 'hidden md:flex': true }"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="emit('toggleCollapse')"
      >
        <UIcon :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'" class="w-4 h-4" />
      </button>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-4 space-y-0.5" :class="collapsed ? 'px-2' : 'px-3'">
      <NuxtLink
        v-for="item in coreNav"
        :key="item.to"
        :to="item.to"
        :title="collapsed ? item.label : undefined"
        class="flex items-center gap-3 py-2 rounded-xl text-sm font-medium transition-colors"
        :class="[
          isActive(item.to) ? 'nav-active' : 'text-gray-600 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5',
          collapsed ? 'justify-center px-2' : 'px-3',
        ]"
      >
        <UIcon :name="item.icon" class="w-4 h-4 shrink-0" />
        <span v-if="!collapsed">{{ item.label }}</span>
      </NuxtLink>

      <template v-if="pluginNav.length">
        <div class="my-2 h-px bg-gray-200 dark:bg-gray-700" :class="collapsed ? 'mx-1' : 'mx-3'" />
        <NuxtLink
          v-for="item in pluginNav"
          :key="item.path"
          :to="item.path"
          :title="collapsed ? item.label : undefined"
          class="flex items-center gap-3 py-2 rounded-xl text-sm font-medium transition-colors"
          :class="[
            route.path === item.path || route.path.startsWith(item.path + '/') ? 'nav-active' : 'text-gray-600 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5',
            collapsed ? 'justify-center px-2' : 'px-3',
          ]"
        >
          <UIcon :name="item.icon" class="w-4 h-4 shrink-0" />
          <span v-if="!collapsed">{{ item.label }}</span>
        </NuxtLink>
      </template>
    </nav>

    <!-- User footer -->
    <div class="shrink-0 p-3" style="border-top: 1px solid var(--glass-xl-border);">
      <div v-if="collapsed" class="flex flex-col items-center gap-2">
        <UAvatar :alt="auth.user?.name" size="sm" />
        <UButton variant="ghost" size="xs" icon="i-lucide-log-out" aria-label="Sign out" @click="auth.signOut()" />
      </div>
      <div v-else class="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
        <UAvatar :alt="auth.user?.name" size="sm" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ auth.user?.name }}</p>
          <p class="text-xs text-gray-400 truncate">{{ auth.user?.email }}</p>
        </div>
        <UButton variant="ghost" size="xs" icon="i-lucide-log-out" aria-label="Sign out" @click="auth.signOut()" />
      </div>
    </div>
  </div>
</template>
