<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()
const id = computed(() => route.params.id as string)
const isNew = computed(() => id.value === 'new')

// server: false — the content API requires auth; the SSR $fetch never carries the
// browser session cookie, so requireUserSession(event) throws and Nuxt marks the
// key as "handled" (with null data), silently preventing any client-side re-fetch.
// Skipping the server fetch entirely lets the client always fetch with its cookie.
const { data: item, refresh } = await useAsyncData(
  `content-${id.value}`,
  () => isNew.value ? Promise.resolve(null) : $fetch<{
    title: string; slug: string; status: string; scheduledAt?: string
    content?: unknown; seoTitle?: string; seoDescription?: string
    settings?: Record<string, unknown>
    allowComments?: boolean | null; typeHasComments?: boolean
  }>(`/api/v1/content/${id.value}`),
  { server: false },
)

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
const EMPTY_CANVAS = { type: 'canvas', blocks: [] }

// form starts empty; populated by the watch below once async data arrives.
// We cannot rely on item.value being set at setup time: when the SSR payload
// is absent (auth middleware can't verify the session server-side on Cloudflare
// Workers, so the page falls back to CSR), item.value is undefined here even
// after the await, because Nuxt resolves the composable before the fetch finishes.
const form = reactive({
  title: '',
  slug: '',
  status: 'draft' as string,
  scheduledAt: undefined as string | undefined,
  content: EMPTY_DOC as unknown,
  seoTitle: '',
  seoDescription: '',
  access: 'public' as string,
  allowComments: null as boolean | null,
})

// Populate (once) when the async data resolves — works for both SSR hydration
// and CSR fetches. A flag prevents overwriting edits the user has already made.
let formSeeded = false
watch(item, (val) => {
  if (!val || formSeeded) return
  formSeeded = true
  form.title = val.title ?? ''
  form.slug = val.slug ?? ''
  form.status = val.status ?? 'draft'
  form.scheduledAt = val.scheduledAt
  form.content = val.content ?? EMPTY_DOC
  form.seoTitle = val.seoTitle ?? ''
  form.seoDescription = val.seoDescription ?? ''
  form.access = (val.settings as Record<string, unknown> | null)?.access as string ?? 'public'
  form.allowComments = val.allowComments ?? null
}, { immediate: true })

// ── Editor mode (TipTap vs Canvas) ───────────────────────────────────────────

const contentIsCanvas = computed(() =>
  (form.content as Record<string, unknown> | null)?.type === 'canvas',
)

// We must never mount TipTap when content is canvas — TipTap would corrupt the
// canvas JSON by emitting an empty doc when it fails to parse the canvas format.
const editorMode = computed<'tiptap' | 'canvas'>(() =>
  contentIsCanvas.value ? 'canvas' : 'tiptap',
)

// Per-session backups so toggling between modes doesn't destroy content
const modeBackup: { tiptap?: unknown; canvas?: unknown } = {}

function switchToCanvas() {
  if (editorMode.value === 'canvas') return
  clearTimeout(autoSaveTimer)
  modeBackup.tiptap = form.content
  form.content = modeBackup.canvas ?? { ...EMPTY_CANVAS }
}

function switchToTipTap() {
  if (editorMode.value === 'tiptap') return
  clearTimeout(autoSaveTimer)
  modeBackup.canvas = form.content
  form.content = modeBackup.tiptap ?? { ...EMPTY_DOC }
}

useHead({ title: computed(() => form.title || (isNew.value ? 'New page' : 'Edit page')) })

// Auto-generate slug from title on new items
watch(() => form.title, (title) => {
  if (isNew.value) {
    form.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }
})

const saving = ref(false)
const lastSaved = ref<Date | null>(null)
const saveError = ref('')
const showRevisions = ref(false)

let autoSaveTimer: ReturnType<typeof setTimeout>
watch(form, () => {
  if (isNew.value) return // don't auto-save before first explicit save
  if (!formSeeded) return  // don't auto-save while initial data is still loading
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => save(), 10_000)
})

async function save(overrideStatus?: string) {
  saving.value = true
  saveError.value = ''
  try {
    const body = {
      title: form.title,
      slug: form.slug,
      status: overrideStatus ?? form.status,
      scheduledAt: form.scheduledAt,
      content: form.content,
      seoTitle: form.seoTitle,
      seoDescription: form.seoDescription,
      settings: { access: form.access },
      allowComments: form.allowComments,
    }
    if (isNew.value) {
      const result = await $fetch<{ id: string }>('/api/v1/content', {
        method: 'POST',
        body: { ...body, typeSlug: (route.query.type as string) || 'page' },
      })
      await navigateTo(`/admin/content/${result.id}`, { replace: true })
    } else {
      await $fetch(`/api/v1/content/${id.value}`, { method: 'PATCH', body })
      lastSaved.value = new Date()
    }
  } catch {
    saveError.value = 'Failed to save. Please try again.'
  } finally {
    saving.value = false
  }
}

async function publish() {
  await save('published')
}

async function generatePreviewLink() {
  const result = await $fetch<{ url: string }>(`/api/v1/content/${id.value}/preview-link`, { method: 'POST' })
  await navigator.clipboard.writeText(result.url)
  useToast().add({ title: 'Preview link copied', description: 'Valid for 48 hours', color: 'green' })
}

// Belt-and-suspenders: if the fetch hasn't fired yet when the component mounts
// (can happen in certain Nuxt 4 hydration edge cases), force it now.
onMounted(() => { if (!item.value && !isNew.value) refresh() })

onUnmounted(() => clearTimeout(autoSaveTimer))
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-4">
    <!-- Top bar -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton to="/admin/content" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
        <span class="text-sm text-gray-400">
          <span v-if="saving">Saving…</span>
          <span v-else-if="saveError" class="text-red-500">{{ saveError }}</span>
          <span v-else-if="lastSaved">Saved {{ lastSaved.toLocaleTimeString() }}</span>
          <span v-else class="text-gray-300">Unsaved</span>
        </span>
      </div>
      <div class="flex items-center gap-2">
        <!-- Editor mode switcher -->
        <div class="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
          <button
            class="px-3 py-1.5 flex items-center gap-1.5 transition-colors"
            :class="editorMode === 'tiptap'
              ? 'bg-primary-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="TipTap rich-text editor"
            @click="switchToTipTap"
          >
            <UIcon name="i-lucide-type" class="w-3.5 h-3.5" />
            Text
          </button>
          <button
            class="px-3 py-1.5 flex items-center gap-1.5 transition-colors"
            :class="editorMode === 'canvas'
              ? 'bg-primary-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'"
            title="Canvas visual block editor"
            @click="switchToCanvas"
          >
            <UIcon name="i-lucide-layout-panel-top" class="w-3.5 h-3.5" />
            Canvas
          </button>
        </div>

        <UButton variant="ghost" size="sm" icon="i-lucide-history" @click="showRevisions = !showRevisions">
          Revisions
        </UButton>
        <UButton
          v-if="!isNew"
          variant="outline"
          size="sm"
          icon="i-lucide-link"
          @click="generatePreviewLink"
        >
          Preview link
        </UButton>
        <UButton
          v-if="!isNew"
          variant="outline"
          size="sm"
          icon="i-lucide-eye"
          :to="`/${form.slug}`"
          target="_blank"
        >
          View
        </UButton>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <!-- Main editor column -->
      <div class="col-span-2 space-y-3">
        <UInput
          v-model="form.title"
          placeholder="Page title"
          size="xl"
          class="text-2xl font-bold"
        />

        <UFormField label="Slug">
          <UInput v-model="form.slug" size="sm" class="font-mono" />
        </UFormField>

        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <!-- TipTap rich-text editor -->
          <EditorContentEditor v-if="editorMode === 'tiptap'" v-model="form.content" />

          <!-- Canvas block editor (requires @nuxflow/plugin-canvas to be installed) -->
          <component
            :is="resolveComponent('CanvasContentEditor')"
            v-else-if="editorMode === 'canvas'"
            v-model="form.content"
          />
        </div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-4">
        <EditorPublishControls
          :model-value="{ status: form.status, scheduledAt: form.scheduledAt }"
          :saving="saving"
          @update:model-value="v => { form.status = v.status; form.scheduledAt = v.scheduledAt }"
          @save="save()"
          @publish="publish()"
        />

        <EditorSeoPanel
          :model-value="{ seoTitle: form.seoTitle, seoDescription: form.seoDescription, access: form.access }"
          :title="form.title"
          :content-id="isNew ? undefined : id"
          @update:model-value="v => { form.seoTitle = v.seoTitle ?? ''; form.seoDescription = v.seoDescription ?? ''; form.access = v.access ?? 'public' }"
        />

        <UCard v-if="item?.typeHasComments" class="text-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="font-medium">Comments</p>
              <p class="text-gray-400 text-xs mt-0.5">
                {{ form.allowComments === null ? 'Inheriting type default (on)' : form.allowComments ? 'Enabled for this post' : 'Disabled for this post' }}
              </p>
            </div>
            <USwitch
              :model-value="form.allowComments ?? true"
              @update:model-value="form.allowComments = $event"
            />
          </div>
          <div v-if="form.allowComments !== null" class="mt-2">
            <UButton variant="ghost" size="xs" class="text-gray-400" @click="form.allowComments = null">
              Reset to type default
            </UButton>
          </div>
        </UCard>

        <EditorTermPicker :content-id="isNew ? undefined : id" />

        <EditorRevisionHistory
          v-if="showRevisions && !isNew"
          :content-id="id"
          @restored="refresh()"
        />
      </div>
    </div>
  </div>
</template>
