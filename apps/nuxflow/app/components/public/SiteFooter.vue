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

const { data: menu } = await useFetch<{ items: unknown[] } | null>('/api/public/menus/footer', {
  headers: useRequestHeaders(['host']),
})

const navItems = computed<MenuItem[]>(() => (menu.value?.items ?? []) as MenuItem[])

function href(item: MenuItem | ChildItem) {
  return item.type === 'url' ? (item.url ?? '/') : `/${item.slug ?? ''}`
}
</script>

<template>
  <footer v-if="navItems.length" class="border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <nav class="flex flex-wrap gap-x-6 gap-y-2">
        <template v-for="item in navItems" :key="item.id">
          <NuxtLink
            :to="href(item)"
            :target="item.target"
            class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {{ item.label }}
            <UIcon v-if="item.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 inline ml-0.5 align-middle" />
          </NuxtLink>
          <NuxtLink
            v-for="child in item.children"
            :key="child.id"
            :to="href(child)"
            :target="child.target"
            class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {{ child.label }}
            <UIcon v-if="child.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 inline ml-0.5 align-middle" />
          </NuxtLink>
        </template>
      </nav>
    </div>
  </footer>
</template>
