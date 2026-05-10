<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()
const id = route.params.id as string
const toast = useToast()

interface ChildItem {
  id: string
  label: string
  type: 'page' | 'url'
  url?: string
  contentId?: string
  slug?: string
  target: '_self' | '_blank'
}

interface MenuItem {
  id: string
  label: string
  type: 'page' | 'url'
  url?: string
  contentId?: string
  slug?: string
  target: '_self' | '_blank'
  children: ChildItem[]
}

// ── Load menu ─────────────────────────────────────────────────────────────────
const { data: menuData, refresh } = await useAsyncData(`menu-${id}`, () =>
  $fetch<{ id: string; name: string; location: string | null; items: unknown[] }>(`/api/v1/menus/${id}`),
  { server: false },
)

useHead({ title: computed(() => menuData.value?.name ?? 'Edit menu') })

const name = ref('')
const location = ref<'header' | 'footer' | 'sidebar' | null>(null)
const items = ref<MenuItem[]>([])

let seeded = false
watch(menuData, (val) => {
  if (!val || seeded) return
  seeded = true
  name.value = val.name
  location.value = val.location as 'header' | 'footer' | 'sidebar' | null
  items.value = (val.items as MenuItem[]).map(item => ({
    ...item,
    children: item.children ?? [],
  }))
}, { immediate: true })

// ── Content picker ────────────────────────────────────────────────────────────
const { data: contentData, refresh: refreshContent } = await useAsyncData('nav-content-picker', () =>
  $fetch<{ items: Array<{ id: string; title: string; slug: string; status: string }> }>('/api/v1/content?type=page'),
  { server: false },
)
// USelect only accepts { label, value } — slug is looked up separately in addItem()
const contentOptions = computed(() =>
  (contentData.value?.items ?? []).map(c => ({ label: c.title, value: c.id })),
)

onMounted(() => {
  if (!menuData.value) refresh()
  if (!contentData.value) refreshContent()
})

// ── Add item form ─────────────────────────────────────────────────────────────
const locationOptions = [
  { label: 'Header', value: 'header' },
  { label: 'Footer', value: 'footer' },
  { label: 'Sidebar', value: 'sidebar' },
]

const addType = ref<'page' | 'url'>('page')
const addContentId = ref<string>('')
const addUrl = ref('')
const addLabel = ref('')
const addTarget = ref<'_self' | '_blank'>('_self')
const addParentId = ref<string | null>(null)  // null = top-level, string = parent id

const topLevelItems = computed(() => items.value)

function addItem() {
  if (addType.value === 'page' && !addContentId.value) return
  if (addType.value === 'url' && !addUrl.value.trim()) return

  const selectedContent = contentData.value?.items.find(c => c.id === addContentId.value)
  const label = addLabel.value.trim() || (addType.value === 'page' ? (selectedContent?.title ?? '') : addUrl.value)

  const newItem: ChildItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label,
    type: addType.value,
    url: addType.value === 'url' ? addUrl.value.trim() : undefined,
    contentId: addType.value === 'page' ? addContentId.value : undefined,
    slug: addType.value === 'page' ? selectedContent?.slug : undefined,
    target: addTarget.value,
  }

  if (addParentId.value) {
    const parent = items.value.find(i => i.id === addParentId.value)
    if (parent) parent.children.push(newItem)
  } else {
    items.value.push({ ...newItem, children: [] })
  }

  // Reset form
  addLabel.value = ''
  addContentId.value = ''
  addUrl.value = ''
  addTarget.value = '_self'
}

function removeItem(itemId: string, parentId?: string) {
  if (parentId) {
    const parent = items.value.find(i => i.id === parentId)
    if (parent) parent.children = parent.children.filter(c => c.id !== itemId)
  } else {
    items.value = items.value.filter(i => i.id !== itemId)
  }
}

function moveItem(index: number, direction: -1 | 1, parentId?: string) {
  const list = parentId ? (items.value.find(i => i.id === parentId)?.children ?? []) : items.value
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= list.length) return
  ;[list[index], list[newIndex]] = [list[newIndex]!, list[index]!]
}

// ── Save ──────────────────────────────────────────────────────────────────────
const saving = ref(false)

async function save() {
  saving.value = true
  try {
    await $fetch(`/api/v1/menus/${id}`, {
      method: 'PATCH',
      body: { name: name.value, location: location.value, items: items.value },
    })
    toast.add({ title: 'Menu saved', color: 'green' })
  } catch {
    toast.add({ title: 'Failed to save', color: 'red' })
  } finally {
    saving.value = false
  }
}

function itemHref(item: MenuItem | ChildItem) {
  if (item.type === 'url') return item.url ?? '#'
  return item.slug ? `/${item.slug}` : '#'
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- Top bar -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton to="/admin/menus" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">{{ name || 'Edit menu' }}</h1>
      </div>
      <UButton icon="i-lucide-save" :loading="saving" @click="save">Save</UButton>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Item list (left, 2/3) -->
      <div class="lg:col-span-2 space-y-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Menu items</h2>

        <!-- Empty state -->
        <div v-if="items.length === 0" class="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center text-sm text-gray-400">
          No items yet — add links below
        </div>

        <!-- Item rows -->
        <div class="space-y-2">
          <div
            v-for="(item, i) in items"
            :key="item.id"
            class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden"
          >
            <!-- Top-level item -->
            <div class="flex items-center gap-3 px-4 py-3">
              <UIcon
                :name="item.type === 'url' ? 'i-lucide-link' : 'i-lucide-file-text'"
                class="w-4 h-4 text-gray-400 shrink-0"
              />
              <div class="flex-1 min-w-0">
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ item.label }}</span>
                <span class="text-xs text-gray-400 ml-2">{{ itemHref(item) }}</span>
                <span v-if="item.target === '_blank'" class="ml-1 text-xs text-gray-400">(new tab)</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <UButton variant="ghost" size="xs" icon="i-lucide-chevron-up" :disabled="i === 0" @click="moveItem(i, -1)" />
                <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" :disabled="i === items.length - 1" @click="moveItem(i, 1)" />
                <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="red" @click="removeItem(item.id)" />
              </div>
            </div>

            <!-- Children -->
            <div v-if="item.children.length > 0" class="border-t border-gray-100 dark:border-gray-800">
              <div
                v-for="(child, ci) in item.children"
                :key="child.id"
                class="flex items-center gap-3 pl-10 pr-4 py-2.5 border-b border-gray-50 dark:border-gray-800/50 last:border-0"
              >
                <UIcon
                  :name="child.type === 'url' ? 'i-lucide-link' : 'i-lucide-file-text'"
                  class="w-3.5 h-3.5 text-gray-300 shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ child.label }}</span>
                  <span class="text-xs text-gray-400 ml-2">{{ itemHref(child) }}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <UButton variant="ghost" size="xs" icon="i-lucide-chevron-up" :disabled="ci === 0" @click="moveItem(ci, -1, item.id)" />
                  <UButton variant="ghost" size="xs" icon="i-lucide-chevron-down" :disabled="ci === item.children.length - 1" @click="moveItem(ci, 1, item.id)" />
                  <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="red" @click="removeItem(child.id, item.id)" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Add item form -->
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Add item</h3>

          <!-- Type toggle -->
          <div class="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden w-fit text-xs">
            <button
              class="px-3 py-1.5 transition-colors"
              :class="addType === 'page' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'"
              @click="addType = 'page'"
            >
              Page
            </button>
            <button
              class="px-3 py-1.5 transition-colors"
              :class="addType === 'url' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'"
              @click="addType = 'url'"
            >
              Custom URL
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <!-- Page select or URL input -->
            <UFormField :label="addType === 'page' ? 'Page' : 'URL'">
              <USelect
                v-if="addType === 'page'"
                v-model="addContentId"
                :items="contentOptions"
                placeholder="Choose a page…"
              />
              <UInput
                v-else
                v-model="addUrl"
                placeholder="https://example.com"
              />
            </UFormField>

            <!-- Label override -->
            <UFormField label="Label" hint="Leave blank to use page title">
              <UInput v-model="addLabel" placeholder="Optional label" />
            </UFormField>

            <!-- Parent (for nesting) -->
            <UFormField label="Add under" hint="Creates a dropdown item">
              <USelect
                v-model="addParentId"
                :items="[{ label: 'Top level', value: null }, ...topLevelItems.map(i => ({ label: i.label, value: i.id }))]"
              />
            </UFormField>

            <!-- Target -->
            <UFormField label="Open in">
              <USelect
                v-model="addTarget"
                :items="[{ label: 'Same tab', value: '_self' }, { label: 'New tab', value: '_blank' }]"
              />
            </UFormField>
          </div>

          <UButton
            variant="outline"
            icon="i-lucide-plus"
            :disabled="addType === 'page' ? !addContentId : !addUrl.trim()"
            @click="addItem"
          >
            Add to menu
          </UButton>
        </div>
      </div>

      <!-- Settings sidebar (right, 1/3) -->
      <div class="space-y-4">
        <UCard>
          <template #header>
            <span class="text-sm font-semibold">Menu settings</span>
          </template>
          <div class="space-y-4">
            <UFormField label="Menu name">
              <UInput v-model="name" placeholder="My Menu" />
            </UFormField>
            <UFormField label="Location" hint="Assign this menu to a slot on your site">
              <USelect
                v-model="location"
                :items="locationOptions"
                placeholder="No location"
              />
            </UFormField>
          </div>
        </UCard>

        <!-- Live preview -->
        <UCard>
          <template #header>
            <span class="text-sm font-semibold">Preview</span>
          </template>
          <nav class="flex flex-col gap-1">
            <div v-if="items.length === 0" class="text-xs text-gray-400 py-2">No items</div>
            <template v-for="item in items" :key="item.id">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                {{ item.label }}
              </div>
              <div v-for="child in item.children" :key="child.id" class="text-sm text-gray-600 dark:text-gray-400 pl-6 py-0.5">
                └ {{ child.label }}
              </div>
            </template>
          </nav>
        </UCard>
      </div>
    </div>
  </div>
</template>
