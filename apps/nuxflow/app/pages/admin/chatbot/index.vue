<script setup lang="ts">
import type { ChatbotStatusResponse } from '#shared/lib/chatbot'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const tabs = [
  { key: 'settings', label: 'Settings', icon: 'i-lucide-sliders-horizontal' },
  { key: 'knowledge', label: 'Knowledge', icon: 'i-lucide-book-open' },
  { key: 'try', label: 'Try it', icon: 'i-lucide-message-square-text' },
  { key: 'conversations', label: 'Conversations', icon: 'i-lucide-messages-square' },
  { key: 'insights', label: 'Insights', icon: 'i-lucide-chart-no-axes-column' },
] as const
type TabKey = typeof tabs[number]['key']

const route = useRoute()
const router = useRouter()
const active = ref<TabKey>((tabs.find(t => t.key === route.query.tab)?.key ?? 'settings') as TabKey)
watch(active, (key) => { router.replace({ query: { ...route.query, tab: key } }) })

const { data: status, refresh, error } = await useFetch<ChatbotStatusResponse>('/_nuxflow/chatbot', { query: { view: 'status' } })
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Chatbot</h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        A chat bubble on your site that answers visitors' questions from your own pages, opening hours and the answers you give it here — and takes their details when the team should get back to them.
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load the chatbot settings — reload the page before saving')" />
    <UAlert
      v-else-if="status && !status.planIncluded"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Not included in your plan"
      description="Your hosting plan doesn't include the chatbot. Ask your host about a plan that does."
    />
    <UAlert
      v-else-if="status && !status.aiAvailable"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No AI available"
      description="The chatbot needs AI to answer. Choose a provider in Settings → AI (Workers AI needs the [ai] binding in wrangler.toml)."
    />

    <div v-if="status" class="flex flex-col md:flex-row gap-6">
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
        <AdminChatbotSettings v-if="active === 'settings'" :status="status" @saved="refresh()" />
        <AdminChatbotKnowledge v-else-if="active === 'knowledge'" :status="status" @changed="refresh()" />
        <AdminChatbotTryIt v-else-if="active === 'try'" :status="status" />
        <AdminChatbotInsights v-else-if="active === 'insights'" />
        <AdminChatbotConversations v-else />
      </div>
    </div>
  </div>
</template>
