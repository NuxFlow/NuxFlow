<script setup lang="ts">
interface ChildItem {
  id: string; label: string; type: 'page' | 'url'
  url?: string; slug?: string; target: '_self' | '_blank'
}
interface MenuItem {
  id: string; label: string; type: 'page' | 'url'
  url?: string; slug?: string; target: '_self' | '_blank'
  children: ChildItem[]
}

const { data: site } = await useFetch('/api/public/site')
const { data: menu } = await useFetch<{ items: unknown[] } | null>('/api/public/menus/header')

const navItems = computed<MenuItem[]>(() => (menu.value?.items ?? []) as MenuItem[])

function href(item: MenuItem | ChildItem) {
  return item.type === 'url' ? (item.url ?? '/') : `/${item.slug ?? ''}`
}

const mobileOpen = ref(false)
const route = useRoute()
watch(() => route.path, () => { mobileOpen.value = false })
</script>

<template>
  <header class="glass sticky top-0 z-50" style="border-bottom: 1px solid var(--glass-border);">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
      <!-- Logo -->
      <NuxtLink to="/" class="font-bold text-lg text-gray-900 dark:text-white hover:text-primary-500 transition-colors shrink-0">
        {{ site?.name ?? 'NuxFlow' }}
      </NuxtLink>

      <!-- Desktop nav -->
      <nav v-if="navItems.length" class="hidden md:flex items-center gap-1 flex-1">
        <template v-for="item in navItems" :key="item.id">
          <!-- Item with dropdown -->
          <div v-if="item.children.length > 0" class="relative group">
            <NuxtLink
              :to="href(item)"
              :target="item.target"
              class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {{ item.label }}
              <UIcon name="i-lucide-chevron-down" class="w-3 h-3 transition-transform group-hover:rotate-180" />
            </NuxtLink>
            <!-- Dropdown -->
            <div class="absolute left-0 top-full mt-1 w-48 glass rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
              <NuxtLink
                v-for="child in item.children"
                :key="child.id"
                :to="href(child)"
                :target="child.target"
                class="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-primary-600 transition-colors"
              >
                {{ child.label }}
                <UIcon v-if="child.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 ml-auto text-gray-400" />
              </NuxtLink>
            </div>
          </div>

          <!-- Simple link -->
          <NuxtLink
            v-else
            :to="href(item)"
            :target="item.target"
            class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {{ item.label }}
            <UIcon v-if="item.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 text-gray-400" />
          </NuxtLink>
        </template>
      </nav>

      <div class="flex items-center gap-2 ml-auto">
        <ClientOnly>
          <UColorModeButton size="sm" />
        </ClientOnly>
        <!-- Mobile hamburger -->
        <button
          v-if="navItems.length"
          class="md:hidden flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-gray-600 dark:text-gray-400"
          :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
          @click="mobileOpen = !mobileOpen"
        >
          <UIcon :name="mobileOpen ? 'i-lucide-x' : 'i-lucide-menu'" class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Mobile nav dropdown -->
    <Transition
      enter-active-class="transition-all duration-200 overflow-hidden"
      enter-from-class="max-h-0 opacity-0"
      enter-to-class="max-h-96 opacity-100"
      leave-active-class="transition-all duration-200 overflow-hidden"
      leave-from-class="max-h-96 opacity-100"
      leave-to-class="max-h-0 opacity-0"
    >
      <nav v-if="mobileOpen" class="md:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-1">
        <template v-for="item in navItems" :key="item.id">
          <NuxtLink
            :to="href(item)"
            :target="item.target"
            class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            {{ item.label }}
            <UIcon v-if="item.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 text-gray-400 ml-auto" />
          </NuxtLink>
          <NuxtLink
            v-for="child in item.children"
            :key="child.id"
            :to="href(child)"
            :target="child.target"
            class="flex items-center gap-2 pl-7 pr-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            {{ child.label }}
          </NuxtLink>
        </template>
      </nav>
    </Transition>
  </header>
</template>
