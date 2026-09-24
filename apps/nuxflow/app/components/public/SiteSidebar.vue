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

const { data: menu } = await useFetch<{ items: unknown[] } | null>('/api/public/menus/sidebar', {
  headers: useRequestHeaders(['host']),
})

const navItems = computed<MenuItem[]>(() => (menu.value?.items ?? []) as MenuItem[])

function href(item: MenuItem | ChildItem) {
  return item.type === 'url' ? (item.url ?? '/') : `/${item.slug ?? ''}`
}
</script>

<template>
  <aside v-if="navItems.length" class="hidden lg:block w-52 shrink-0 border-l border-gray-200 dark:border-gray-800">
    <nav class="sticky top-14 py-6 px-3 space-y-0.5">
      <template v-for="item in navItems" :key="item.id">
        <NuxtLink
          :to="href(item)"
          :target="item.target"
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          {{ item.label }}
          <UIcon v-if="item.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 text-gray-400 ml-auto shrink-0" />
        </NuxtLink>
        <NuxtLink
          v-for="child in item.children"
          :key="child.id"
          :to="href(child)"
          :target="child.target"
          class="flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          {{ child.label }}
          <UIcon v-if="child.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 text-gray-400 ml-auto shrink-0" />
        </NuxtLink>
      </template>
    </nav>
  </aside>
</template>
