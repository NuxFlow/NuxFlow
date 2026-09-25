<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Inbox' })

interface InboxMessage {
  id: string
  threadId: string
  mailboxId: string | null
  mailboxName: string
  fromAddress: string
  fromName: string | null
  toAddress: string
  subject: string
  snippet: string
  status: 'new' | 'read' | 'archived' | 'spam'
  category: string | null
  aiSummary: string | null
  attachmentCount: number
  createdAt: string
}

type Folder = 'inbox' | 'new' | 'archived' | 'spam'
const folders: { label: string; value: Folder; icon: string }[] = [
  { label: 'Inbox', value: 'inbox', icon: 'i-lucide-inbox' },
  { label: 'Unread', value: 'new', icon: 'i-lucide-mail' },
  { label: 'Archived', value: 'archived', icon: 'i-lucide-archive' },
  { label: 'Spam', value: 'spam', icon: 'i-lucide-shield-x' },
]

const route = useRoute()
const router = useRouter()
const folder = ref<Folder>('inbox')
const category = ref<string | undefined>(undefined)
const search = ref('')
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedSearch.value = value }, 300)
})
const page = ref(1)

const selectedId = computed<string | null>(() => (typeof route.query.message === 'string' ? route.query.message : null))

const access = await fetchAdminAccess()
const isAdmin = computed(() => roleAtLeast(access?.role, 'admin') || !!access?.isSuperAdmin)

const { data, pending, refresh } = await useFetch<{ messages: InboxMessage[]; total: number; unread: number; limit: number }>('/api/v1/inbox', {
  query: computed(() => ({ folder: folder.value, category: category.value, q: debouncedSearch.value || undefined, page: page.value })),
  watch: [folder, category, debouncedSearch, page],
  default: () => ({ messages: [], total: 0, unread: 0, limit: 50 }),
})

watch([folder, category, debouncedSearch], () => { page.value = 1 })

const { data: mailboxData } = await useFetch<{ mailboxes: unknown[] }>('/api/v1/mailboxes', {
  default: () => ({ mailboxes: [] }),
  // Only admins can list mailboxes; editors just see the empty-state copy without the setup link.
  immediate: isAdmin.value,
})
const noMailboxes = computed(() => isAdmin.value && mailboxData.value.mailboxes.length === 0)

const categoryOptions = [
  { label: 'All categories', value: undefined },
  { label: 'Leads', value: 'lead' },
  { label: 'Support', value: 'support' },
  { label: 'Other', value: 'other' },
]

function select(id: string) {
  router.replace({ query: { ...route.query, message: id } })
}

function closeDetail() {
  const { message: _message, ...rest } = route.query
  router.replace({ query: rest })
}

async function onChanged() {
  await refresh()
}

async function onDeleted() {
  closeDetail()
  await refresh()
}

function fromLabel(m: InboxMessage) {
  return m.fromName || m.fromAddress
}

function shortDate(value: string) {
  const d = parseDbDate(value)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const totalPages = computed(() => Math.max(1, Math.ceil(data.value.total / data.value.limit)))
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Inbox</h1>
        <p class="text-sm text-gray-500 mt-0.5">
          Email sent to this site's addresses
          <template v-if="data.unread"> · {{ data.unread }} unread</template>
        </p>
      </div>
      <UButton v-if="isAdmin" to="/admin/inbox/mailboxes" variant="outline" icon="i-lucide-at-sign">Addresses</UButton>
    </div>

    <UAlert
      v-if="noMailboxes"
      color="info"
      variant="soft"
      icon="i-lucide-info"
      title="No receiving addresses yet"
      description="Create an address such as contact@ or leads@ and connect your domain, and email sent to it lands here."
      :actions="[{ label: 'Set up addresses', to: '/admin/inbox/mailboxes' }]"
    />

    <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <!-- List -->
      <div class="space-y-3 min-w-0" :class="selectedId ? 'hidden lg:block' : ''">
        <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl overflow-x-auto">
          <button
            v-for="f in folders"
            :key="f.value"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            :class="folder === f.value
              ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-white'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
            @click="folder = f.value"
          >
            <UIcon :name="f.icon" class="w-4 h-4" />
            {{ f.label }}
          </button>
        </div>

        <div class="flex gap-2">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search subject or sender" class="flex-1 min-w-0" />
          <USelect v-model="category" :items="categoryOptions" class="w-40" />
        </div>

        <div v-if="pending && !data.messages.length" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-gray-400" />
        </div>

        <div v-else-if="!data.messages.length" class="text-center py-16 text-gray-400">
          <UIcon name="i-lucide-inbox" class="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p class="text-sm">Nothing here</p>
        </div>

        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <li v-for="m in data.messages" :key="m.id">
            <button
              class="w-full text-left px-4 py-3 transition-colors"
              :class="[
                selectedId === m.id ? 'bg-primary-50 dark:bg-primary-950' : 'hover:bg-gray-50 dark:hover:bg-gray-900',
              ]"
              @click="select(m.id)"
            >
              <div class="flex items-baseline justify-between gap-3">
                <p class="text-sm truncate" :class="m.status === 'new' ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'">
                  <span v-if="m.status === 'new'" class="inline-block w-2 h-2 rounded-full bg-primary-500 mr-1.5 align-middle" />{{ fromLabel(m) }}
                </p>
                <span class="text-xs text-gray-400 shrink-0">{{ shortDate(m.createdAt) }}</span>
              </div>
              <p class="text-sm truncate mt-0.5" :class="m.status === 'new' ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'">
                {{ m.subject || '(no subject)' }}
              </p>
              <p class="text-xs text-gray-400 truncate mt-0.5">{{ m.aiSummary || m.snippet }}</p>
              <div class="flex items-center gap-1.5 mt-1.5">
                <UBadge :label="m.mailboxName" variant="outline" size="xs" color="neutral" />
                <UBadge v-if="m.category" :label="m.category" variant="soft" size="xs" :color="m.category === 'lead' ? 'success' : m.category === 'support' ? 'info' : 'neutral'" />
                <UIcon v-if="m.attachmentCount" name="i-lucide-paperclip" class="w-3.5 h-3.5 text-gray-400" />
              </div>
            </button>
          </li>
        </ul>

        <div v-if="totalPages > 1" class="flex items-center justify-between text-sm text-gray-500">
          <UButton size="xs" variant="ghost" icon="i-lucide-chevron-left" :disabled="page <= 1" @click="page--">Newer</UButton>
          <span>Page {{ page }} of {{ totalPages }}</span>
          <UButton size="xs" variant="ghost" trailing-icon="i-lucide-chevron-right" :disabled="page >= totalPages" @click="page++">Older</UButton>
        </div>
      </div>

      <!-- Detail -->
      <div class="min-w-0" :class="selectedId ? '' : 'hidden lg:block'">
        <template v-if="selectedId">
          <UButton class="lg:hidden mb-3" size="xs" variant="ghost" icon="i-lucide-arrow-left" @click="closeDetail">Back</UButton>
          <AdminInboxThreadView :key="selectedId" :message-id="selectedId" :can-delete="isAdmin" @changed="onChanged" @deleted="onDeleted" />
        </template>
        <div v-else class="h-full min-h-64 flex items-center justify-center rounded-xl border border-dashed border-gray-200 dark:border-gray-800 text-sm text-gray-400">
          Select a message to read it
        </div>
      </div>
    </div>
  </div>
</template>
