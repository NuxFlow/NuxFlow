<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const toast = useToast()

const tabs = [
  { label: 'Global defaults', icon: 'i-lucide-globe' },
  { label: 'AI Crawlers', icon: 'i-lucide-bot' },
  { label: 'Redirects', icon: 'i-lucide-arrow-right-left' },
]
const active = ref('Global defaults')

// ── Global SEO defaults ───────────────────────────────────────────────────────

interface SettingsData {
  site: { id: string; name: string; domain: string }
  settings: Record<string, unknown>
}

const { data: settingsData, refresh: refreshSettings } = await useFetch<SettingsData>('/api/v1/settings')

const seo = reactive({
  title: '',
  description: '',
  canonicalUrl: '',
  ogImage: '',
  robots: 'index' as 'index' | 'noindex',
  aiCrawlers: 'allow' as 'allow' | 'disallow',
})

watch(settingsData, (d) => {
  if (!d) return
  const s = d.settings
  seo.title = (s['seo.title'] as string) ?? ''
  seo.description = (s['seo.description'] as string) ?? ''
  seo.canonicalUrl = (s['seo.canonical_url'] as string) ?? ''
  seo.ogImage = (s['seo.og_image'] as string) ?? ''
  seo.robots = ((s['seo.robots'] as string) ?? 'index') as 'index' | 'noindex'
  seo.aiCrawlers = ((s['seo.ai_crawlers'] as string) ?? 'allow') as 'allow' | 'disallow'
}, { immediate: true })

const savingGlobal = ref(false)
const aiSuggestLoading = ref(false)

async function aiSuggestGlobal() {
  const title = seo.title || settingsData.value?.site?.name || ''
  if (!title) return
  aiSuggestLoading.value = true
  try {
    const res = await $fetch<{ seoTitle: string; seoDescription: string }>('/api/v1/ai/seo-suggest', {
      method: 'POST',
      body: { title },
    })
    if (res.seoTitle) seo.title = res.seoTitle
    if (res.seoDescription) seo.description = res.seoDescription
  } catch {
    // AI not configured — fail silently
  } finally {
    aiSuggestLoading.value = false
  }
}

async function saveGlobal() {
  savingGlobal.value = true
  try {
    await $fetch('/api/v1/settings', {
      method: 'PATCH',
      body: {
        settings: {
          'seo.title': seo.title,
          'seo.description': seo.description,
          'seo.canonical_url': seo.canonicalUrl,
          'seo.og_image': seo.ogImage,
          'seo.robots': seo.robots,
          'seo.ai_crawlers': seo.aiCrawlers,
        },
      },
    })
    toast.add({ title: 'SEO settings saved', color: 'green' })
    await refreshSettings()
  } catch {
    toast.add({ title: 'Failed to save settings', color: 'red' })
  } finally {
    savingGlobal.value = false
  }
}

// ── Redirects ─────────────────────────────────────────────────────────────────

interface Redirect {
  id: string
  from: string
  to: string
  statusCode: number
  createdAt: string
}

const { data: redirectData, refresh: refreshRedirects } = await useFetch<{ redirects: Redirect[] }>('/api/v1/redirects')
const redirects = computed(() => redirectData.value?.redirects ?? [])

const addForm = reactive({ from: '', to: '', statusCode: 301 as 301 | 302 })
const addError = ref('')
const adding = ref(false)

const statusOptions = [
  { label: '301 — Permanent', value: 301 },
  { label: '302 — Temporary', value: 302 },
]

async function addRedirect() {
  addError.value = ''
  if (!addForm.from.startsWith('/')) {
    addError.value = '"From" path must start with /'
    return
  }
  if (!addForm.to) {
    addError.value = '"To" is required'
    return
  }
  adding.value = true
  try {
    await $fetch('/api/v1/redirects', {
      method: 'POST',
      body: { from: addForm.from, to: addForm.to, statusCode: addForm.statusCode },
    })
    addForm.from = ''
    addForm.to = ''
    addForm.statusCode = 301
    await refreshRedirects()
    toast.add({ title: 'Redirect added', color: 'green' })
  } catch {
    addError.value = 'Failed to add redirect. Check for duplicates.'
  } finally {
    adding.value = false
  }
}

const deletingId = ref<string | null>(null)

async function deleteRedirect(id: string) {
  deletingId.value = id
  try {
    await $fetch(`/api/v1/redirects/${id}`, { method: 'DELETE' })
    await refreshRedirects()
    toast.add({ title: 'Redirect deleted', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to delete redirect', color: 'red' })
  } finally {
    deletingId.value = null
  }
}

const columns = [
  { accessorKey: 'from', header: 'From' },
  { accessorKey: 'to', header: 'To' },
  { accessorKey: 'statusCode', header: 'Type' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">SEO</h1>

    <div class="flex gap-6">
      <!-- Sidebar nav -->
      <nav class="w-48 shrink-0 space-y-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.label"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left"
          :class="active === tab.label
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'"
          @click="active = tab.label"
        >
          <UIcon :name="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </nav>

      <!-- Tab content -->
      <div class="flex-1 space-y-4">

        <!-- Global defaults -->
        <template v-if="active === 'Global defaults'">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">Global SEO defaults</p>
                  <p class="text-xs text-gray-400 mt-0.5">Applied to pages that don't have their own SEO fields set</p>
                </div>
                <UButton
                  icon="i-lucide-sparkles"
                  size="sm"
                  variant="outline"
                  :loading="aiSuggestLoading"
                  :disabled="!seo.title && !settingsData?.site?.name"
                  title="Generate title and description with AI"
                  @click="aiSuggestGlobal"
                >
                  AI Suggest
                </UButton>
              </div>
            </template>
            <div class="space-y-4">
              <UFormField label="Default site title" hint="Used as fallback og:title and <title>">
                <UInput v-model="seo.title" placeholder="My Site — The best CMS" class="w-full" />
                <p class="mt-1 text-xs" :class="seo.title.length > 60 ? 'text-amber-500' : 'text-gray-400'">
                  {{ seo.title.length }} / 60 characters
                </p>
              </UFormField>

              <UFormField label="Default meta description" hint="Fallback description for search results">
                <UTextarea v-model="seo.description" :rows="3" placeholder="A short description of your site shown in search results…" class="w-full" />
                <p class="mt-1 text-xs" :class="seo.description.length > 160 ? 'text-amber-500' : 'text-gray-400'">
                  {{ seo.description.length }} / 160 characters
                </p>
              </UFormField>

              <UFormField label="Canonical URL prefix" hint="Base URL used to build canonical tags, e.g. https://example.com">
                <UInput v-model="seo.canonicalUrl" placeholder="https://example.com" class="w-full" />
              </UFormField>

              <UFormField label="Default OG image URL" hint="Fallback social share image for pages without a custom image">
                <UInput v-model="seo.ogImage" placeholder="https://example.com/og-default.png" class="w-full" />
              </UFormField>

              <UFormField label="Search engine indexing">
                <USelect
                  v-model="seo.robots"
                  :items="[
                    { label: 'Allow indexing (index, follow)', value: 'index' },
                    { label: 'Block all crawlers (noindex, nofollow)', value: 'noindex' },
                  ]"
                  class="w-full"
                />
                <p v-if="seo.robots === 'noindex'" class="mt-1.5 text-xs text-amber-500 flex items-center gap-1">
                  <UIcon name="i-lucide-triangle-alert" class="w-3.5 h-3.5" />
                  Your entire site will be hidden from search engines
                </p>
              </UFormField>
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="savingGlobal" @click="saveGlobal">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- AI Crawlers -->
        <template v-if="active === 'AI Crawlers'">
          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Generative Engine Optimization (GEO)</p>
              <p class="text-xs text-gray-400 mt-0.5">Control whether AI assistants (ChatGPT, Claude, Perplexity, etc.) can crawl and index your site</p>
            </template>
            <div class="space-y-5">
              <UAlert
                icon="i-lucide-cloud"
                color="yellow"
                variant="soft"
                title="Check your Cloudflare dashboard"
                description="Cloudflare's 'Block AI Scrapers and Crawlers' toggle (Dashboard → your domain → Security → Bots) blocks AI crawlers at the network level before they reach your site — overriding the setting below. Ensure it is turned off if you want GEO visibility."
              />

              <UFormField label="AI crawler access">
                <USelect
                  v-model="seo.aiCrawlers"
                  :items="[
                    { label: 'Allow all AI crawlers (recommended for GEO visibility)', value: 'allow' },
                    { label: 'Block all AI crawlers', value: 'disallow' },
                  ]"
                  class="w-full"
                />
                <p v-if="seo.aiCrawlers === 'disallow'" class="mt-1.5 text-xs text-amber-500 flex items-center gap-1">
                  <UIcon name="i-lucide-triangle-alert" class="w-3.5 h-3.5" />
                  Your site will be excluded from AI-generated answers and recommendations
                </p>
              </UFormField>

              <UAlert
                icon="i-lucide-info"
                color="blue"
                variant="soft"
                title="What is GEO?"
                description="Generative Engine Optimization ensures your content appears in answers from AI assistants like ChatGPT, Claude, and Perplexity. Allowing AI crawlers is required for your site to be cited as a source."
              />

              <div class="space-y-2">
                <p class="text-xs font-medium text-gray-700 dark:text-gray-300">Bots controlled by this setting</p>
                <div class="grid grid-cols-2 gap-1.5">
                  <div
                    v-for="bot in ['GPTBot (OpenAI)', 'ChatGPT-User (OpenAI)', 'ClaudeBot (Anthropic)', 'anthropic-ai', 'PerplexityBot', 'Googlebot-Extended', 'cohere-ai', 'CCBot (Common Crawl)', 'Applebot-Extended', 'FacebookBot (Meta)']"
                    :key="bot"
                    class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
                  >
                    <UIcon
                      :name="seo.aiCrawlers === 'allow' ? 'i-lucide-check-circle' : 'i-lucide-x-circle'"
                      class="w-3.5 h-3.5 shrink-0"
                      :class="seo.aiCrawlers === 'allow' ? 'text-green-500' : 'text-red-400'"
                    />
                    {{ bot }}
                  </div>
                </div>
              </div>

              <UAlert
                icon="i-lucide-file-text"
                color="neutral"
                variant="soft"
                title="llms.txt is auto-generated"
                description="NuxFlow automatically serves /llms.txt — a machine-readable index of your content for AI systems. No configuration needed."
              />
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="savingGlobal" @click="saveGlobal">Save changes</UButton>
              </div>
            </template>
          </UCard>
        </template>

        <!-- Redirects -->
        <template v-if="active === 'Redirects'">
          <!-- Add form -->
          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Add redirect</p>
              <p class="text-xs text-gray-400 mt-0.5">Redirects are checked before page content is served</p>
            </template>
            <div class="space-y-3">
              <div class="grid grid-cols-5 gap-3 items-end">
                <UFormField label="From path" class="col-span-2">
                  <UInput v-model="addForm.from" placeholder="/old-page" class="w-full font-mono text-sm" />
                </UFormField>
                <UFormField label="To" class="col-span-2">
                  <UInput v-model="addForm.to" placeholder="/new-page or https://example.com" class="w-full font-mono text-sm" />
                </UFormField>
                <UFormField label="Type">
                  <USelect v-model="addForm.statusCode" :items="statusOptions" class="w-full" />
                </UFormField>
              </div>
              <UAlert v-if="addError" color="red" variant="soft" :description="addError" />
            </div>
            <template #footer>
              <div class="flex justify-end">
                <UButton :loading="adding" icon="i-lucide-plus" @click="addRedirect">Add redirect</UButton>
              </div>
            </template>
          </UCard>

          <!-- Redirect list -->
          <UCard>
            <template #header>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">Active redirects</p>
              <p class="text-xs text-gray-400 mt-0.5">{{ redirects.length }} redirect{{ redirects.length === 1 ? '' : 's' }}</p>
            </template>

            <div v-if="!redirects.length" class="text-center py-10 text-gray-400">
              <UIcon name="i-lucide-arrow-right-left" class="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p class="text-sm">No redirects yet</p>
            </div>

            <UTable
              v-else
              :data="redirects"
              :columns="columns"
            >
              <template #from-cell="{ row }">
                <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ row.original.from }}</code>
              </template>
              <template #to-cell="{ row }">
                <code class="text-xs text-primary-600 dark:text-primary-400">{{ row.original.to }}</code>
              </template>
              <template #statusCode-cell="{ row }">
                <UBadge
                  :color="row.original.statusCode === 301 ? 'blue' : 'yellow'"
                  variant="soft"
                  size="sm"
                >
                  {{ row.original.statusCode }} {{ row.original.statusCode === 301 ? 'Permanent' : 'Temporary' }}
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <div class="flex justify-end">
                  <UButton
                    variant="ghost"
                    color="red"
                    size="xs"
                    icon="i-lucide-trash-2"
                    :loading="deletingId === row.original.id"
                    @click="deleteRedirect(row.original.id)"
                  />
                </div>
              </template>
            </UTable>
          </UCard>
        </template>

      </div>
    </div>
  </div>
</template>
