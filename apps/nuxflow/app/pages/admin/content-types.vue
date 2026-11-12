<script setup lang="ts">
import { CUSTOM_FIELD_TYPES, fieldKeyFrom, type CustomFieldDef, type CustomFieldType } from '#shared/lib/custom-fields'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Content types' })

// Admin → Content types: the kinds of content a site has (pages, posts, events — and its own,
// such as properties or menu items) and each one's custom fields. One POST with an `action`
// (server/api/v1/content-types/index.post.ts).

interface TypeRow {
  id: string
  slug: string
  name: string
  singularName: string
  isBuiltIn: boolean
  fields: CustomFieldDef[]
  itemCount: number
}

/** A field being edited: choices as one per line, and whether its key was typed by hand. */
interface FieldDraft extends Omit<CustomFieldDef, 'options'> {
  optionsText: string
  keyEdited: boolean
  isNew: boolean
}

const { run, isRunning } = useAdminAction()
const { confirm } = useConfirm()
const { data, refresh, error } = await useFetch<{ types: TypeRow[] }>('/api/v1/content-types', { server: false })
const types = computed(() => data.value?.types ?? [])

// ── New type ────────────────────────────────────────────────────────────────
const showNew = ref(false)
const newType = reactive({ name: '', singularName: '', slug: '', slugEdited: false })
watch(() => newType.singularName, (v) => {
  if (!newType.slugEdited) newType.slug = fieldKeyFrom(v).replace(/_/g, '-')
})

async function createType() {
  const res = await run(() => $fetch<{ id: string }>('/api/v1/content-types', {
    method: 'POST',
    body: { action: 'create', name: newType.name, singularName: newType.singularName, slug: newType.slug },
  }), { successTitle: 'Content type added', errorTitle: 'Couldn\'t add the content type', key: 'create' })
  if (!res) return
  Object.assign(newType, { name: '', singularName: '', slug: '', slugEdited: false })
  showNew.value = false
  await refresh()
  const created = types.value.find(t => t.id === res.id)
  if (created) startEditing(created)
}

// ── Fields ──────────────────────────────────────────────────────────────────
const editingId = ref<string | null>(null)
const drafts = ref<FieldDraft[]>([])
const typeItems = CUSTOM_FIELD_TYPES.map(t => ({ label: t.label, value: t.value }))

function startEditing(type: TypeRow) {
  editingId.value = type.id
  drafts.value = type.fields.map(f => ({ ...f, optionsText: (f.options ?? []).join('\n'), keyEdited: true, isNew: false }))
}

function addField() {
  drafts.value.push({ key: '', label: '', type: 'text', optionsText: '', keyEdited: false, isNew: true, showOnPage: true })
}

function onLabel(field: FieldDraft) {
  if (!field.keyEdited && field.isNew) field.key = fieldKeyFrom(field.label)
}

function move(index: number, by: -1 | 1) {
  const to = index + by
  if (to < 0 || to >= drafts.value.length) return
  const list = [...drafts.value]
  const [f] = list.splice(index, 1)
  list.splice(to, 0, f!)
  drafts.value = list
}

const hasChoices = (type: CustomFieldType) => type === 'select' || type === 'multiselect'
// Listings can be filtered by numbers, yes/no and choices (server/utils/field-filters.ts).
const canFilter = (type: CustomFieldType) => type === 'number' || type === 'boolean' || hasChoices(type)

async function saveFields(type: TypeRow) {
  const fields = drafts.value.map(f => ({
    key: f.key.trim(),
    label: f.label.trim(),
    type: f.type,
    ...(hasChoices(f.type) ? { options: f.optionsText.split('\n').map(o => o.trim()).filter(Boolean) } : {}),
    ...(f.required ? { required: true } : {}),
    ...(f.type === 'number' && f.prefix?.trim() ? { prefix: f.prefix.trim() } : {}),
    ...(f.type === 'number' && f.suffix?.trim() ? { suffix: f.suffix.trim() } : {}),
    ...(f.showOnPage === false ? { showOnPage: false } : {}),
    ...(f.filterable && canFilter(f.type) ? { filterable: true } : {}),
  }))
  const ok = await run(() => $fetch<{ success: boolean }>('/api/v1/content-types', {
    method: 'POST',
    body: { action: 'update', id: type.id, fields },
  }), { successTitle: `${type.name}: fields saved`, errorTitle: 'Couldn\'t save the fields', key: `save:${type.id}` })
  if (!ok) return
  editingId.value = null
  await refresh()
}

async function deleteType(type: TypeRow) {
  const confirmed = await confirm({ title: `Delete "${type.name}"?`, description: 'The content type and its fields are removed. It has no items.', confirmLabel: 'Delete', color: 'error' })
  if (!confirmed) return
  const ok = await run(() => $fetch<{ success: boolean }>('/api/v1/content-types', {
    method: 'POST',
    body: { action: 'delete', id: type.id },
  }), { successTitle: 'Content type deleted', errorTitle: 'Couldn\'t delete the content type', key: `delete:${type.id}` })
  if (ok) await refresh()
}
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">Content types</h1>
        <p class="mt-1 text-sm text-gray-500">
          The kinds of content on your site. Add your own (properties, menu items, team members) and give any type extra fields, such as a price or the number of bedrooms. They appear in the editor and on the item's page.
        </p>
      </div>
      <UButton icon="i-lucide-plus" @click="showNew = !showNew">New content type</UButton>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ getErrorMessage(error, 'Could not load the content types') }}</p>

    <UCard v-if="showNew">
      <form class="grid gap-4 sm:grid-cols-3" @submit.prevent="createType">
        <UFormField label="Name (plural)" hint="e.g. Properties">
          <UInput v-model="newType.name" required class="w-full" />
        </UFormField>
        <UFormField label="One of them" hint="e.g. Property">
          <UInput v-model="newType.singularName" required class="w-full" />
        </UFormField>
        <UFormField label="Key" hint="Can't be changed later">
          <UInput v-model="newType.slug" required class="w-full" @update:model-value="newType.slugEdited = true" />
        </UFormField>
        <div class="sm:col-span-3 flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showNew = false">Cancel</UButton>
          <UButton type="submit" :loading="isRunning('create')">Add content type</UButton>
        </div>
      </form>
    </UCard>

    <UCard v-for="type in types" :key="type.id">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="font-semibold text-gray-900 dark:text-white">
            {{ type.name }}
            <UBadge v-if="type.isBuiltIn" size="xs" variant="soft" color="neutral" class="ml-1">Built-in</UBadge>
          </p>
          <p class="text-xs text-gray-500">
            {{ type.itemCount }} {{ type.itemCount === 1 ? 'item' : 'items' }} ·
            {{ type.fields.length ? `${type.fields.length} ${type.fields.length === 1 ? 'field' : 'fields'}: ${type.fields.map(f => f.label).join(', ')}` : 'No extra fields' }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton size="sm" variant="ghost" :to="`/admin/content?type=${type.slug}`">Open</UButton>
          <UButton v-if="editingId !== type.id" size="sm" variant="outline" icon="i-lucide-list-plus" @click="startEditing(type)">Fields</UButton>
          <UButton
            v-if="!type.isBuiltIn"
            size="sm"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            :disabled="type.itemCount > 0"
            :title="type.itemCount > 0 ? 'Delete its items first' : undefined"
            :loading="isRunning(`delete:${type.id}`)"
            :aria-label="`Delete ${type.name}`"
            @click="deleteType(type)"
          />
        </div>
      </div>

      <div v-if="editingId === type.id" class="mt-4 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-4">
        <p v-if="!drafts.length" class="text-sm text-gray-500">No fields yet. Add one below.</p>
        <div v-for="(field, i) in drafts" :key="i" class="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div class="grid gap-3 sm:grid-cols-[1fr_10rem_10rem_auto]">
            <UFormField label="Name">
              <UInput v-model="field.label" class="w-full" placeholder="Bedrooms" @update:model-value="onLabel(field)" />
            </UFormField>
            <UFormField label="Type">
              <USelect v-model="field.type" :items="typeItems" class="w-full" />
            </UFormField>
            <UFormField label="Key" :hint="field.isNew ? undefined : 'Keeps saved values'">
              <UInput v-model="field.key" class="w-full" :disabled="!field.isNew" @update:model-value="field.keyEdited = true" />
            </UFormField>
            <div class="flex items-end gap-1">
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-up" :disabled="i === 0" :aria-label="`Move ${field.label || 'field'} up`" @click="move(i, -1)" />
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-chevron-down" :disabled="i === drafts.length - 1" :aria-label="`Move ${field.label || 'field'} down`" @click="move(i, 1)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" :aria-label="`Remove ${field.label || 'field'}`" @click="drafts.splice(i, 1)" />
            </div>
          </div>
          <UFormField v-if="hasChoices(field.type)" label="Choices" hint="One per line">
            <UTextarea v-model="field.optionsText" :rows="3" class="w-full" placeholder="Parking&#10;Garden&#10;EV charger" />
          </UFormField>
          <div v-if="field.type === 'number'" class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Before the number" hint="e.g. £">
              <UInput v-model="field.prefix" class="w-full" />
            </UFormField>
            <UFormField label="After the number" hint="e.g. sq ft">
              <UInput v-model="field.suffix" class="w-full" />
            </UFormField>
          </div>
          <div class="flex flex-wrap gap-6">
            <UCheckbox v-model="field.required" label="Must be filled in to publish" />
            <UCheckbox
              :model-value="field.showOnPage !== false"
              label="Show on the page"
              @update:model-value="field.showOnPage = $event === true"
            />
            <UCheckbox
              v-if="canFilter(field.type)"
              :model-value="field.filterable === true"
              label="Use as a filter on listings"
              @update:model-value="field.filterable = $event === true"
            />
          </div>
        </div>
        <div class="flex flex-wrap justify-between gap-2">
          <UButton size="sm" variant="outline" icon="i-lucide-plus" @click="addField">Add field</UButton>
          <div class="flex gap-2">
            <UButton size="sm" variant="ghost" color="neutral" @click="editingId = null">Cancel</UButton>
            <UButton size="sm" :loading="isRunning(`save:${type.id}`)" @click="saveFields(type)">Save fields</UButton>
          </div>
        </div>
        <p class="text-xs text-gray-400">Removing a field hides it, but values already saved are kept and come back if you add a field with the same key.</p>
      </div>
    </UCard>
  </div>
</template>
