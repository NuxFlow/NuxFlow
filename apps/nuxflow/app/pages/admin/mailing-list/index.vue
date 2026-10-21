<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const tabs = [
  { key: 'subscribers', label: 'Subscribers', icon: 'i-lucide-users' },
  { key: 'signup', label: 'Signup popup', icon: 'i-lucide-panel-bottom-open' },
] as const
type TabKey = typeof tabs[number]['key']

const route = useRoute()
const router = useRouter()
const active = ref<TabKey>((tabs.find(t => t.key === route.query.tab)?.key ?? 'subscribers') as TabKey)
watch(active, (key) => { router.replace({ query: { ...route.query, tab: key } }) })
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Mailing list</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        People who signed up for email from this site, through the signup popup or a Signup box block on a page.
      </p>
    </div>

    <div class="flex flex-col md:flex-row gap-6">
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

      <div class="flex-1 min-w-0 space-y-4">
        <AdminMailingListSubscribers v-if="active === 'subscribers'" />
        <AdminMailingListSignupSettings v-else />
      </div>
    </div>
  </div>
</template>
