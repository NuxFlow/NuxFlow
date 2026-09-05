<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()
const id = route.params.id as string
const isNew = id === 'new'

const fieldTypes = [
  { label: 'Short text', type: 'text', icon: 'i-lucide-type' },
  { label: 'Long text', type: 'textarea', icon: 'i-lucide-align-left' },
  { label: 'Email', type: 'email', icon: 'i-lucide-mail' },
  { label: 'Number', type: 'number', icon: 'i-lucide-hash' },
  { label: 'Select', type: 'select', icon: 'i-lucide-chevrons-up-down' },
  { label: 'Radio', type: 'radio', icon: 'i-lucide-circle-dot' },
  { label: 'Checkbox', type: 'checkbox', icon: 'i-lucide-check-square' },
  { label: 'Date', type: 'date', icon: 'i-lucide-calendar' },
  { label: 'File upload', type: 'file', icon: 'i-lucide-upload' },
  { label: 'Signature', type: 'signature', icon: 'i-lucide-signature' },
  { label: 'Hidden', type: 'hidden', icon: 'i-lucide-eye-off' },
  // Computed fields evaluate their `formula` expression client-side, substituting
  // {{fieldName}} with sibling field values — see FormsFieldsComputedField.vue
  // and DynamicFormBlock.vue's evaluateFormula().
  { label: 'Computed', type: 'computed', icon: 'i-lucide-function-square' },
]

// Field types whose value editing UI is a free-text option list (label/value pairs).
const OPTION_TYPES = ['select', 'radio', 'checkbox']
// Field types that take a placeholder shown in the empty input.
const PLACEHOLDER_TYPES = ['text', 'email', 'number', 'textarea']

interface FormFieldOption { label: string; value: string }
interface FormField {
  id: string
  type: string
  label: string
  name: string
  required?: boolean
  placeholder?: string
  options?: FormFieldOption[]
  formula?: string
}

interface NotificationsConfig {
  enabled: boolean
  email: string
}

const name = ref('Untitled form')
const slug = ref('untitled-form')
const fields = ref<FormField[]>([])
const notifications = ref<NotificationsConfig>({ enabled: false, email: '' })
const selectedField = ref<FormField | null>(null)
const saving = ref(false)

// server: false — this endpoint requires an editor session; the SSR $fetch
// never carries the browser session cookie (same reasoning as the content
// editor at app/pages/admin/content/[id].vue), so skip the server fetch and
// always load on the client where the cookie is present.
const { data: existingForm } = await useAsyncData(
  `form-edit-${id}`,
  () => isNew ? Promise.resolve(null) : $fetch<{
    name: string
    slug: string
    fields: FormField[]
    notifications?: Partial<NotificationsConfig> | null
  }>(`/api/v1/forms/${id}`),
  { server: false },
)

let formSeeded = false
watch(existingForm, (val) => {
  if (!val || formSeeded) return
  formSeeded = true
  name.value = val.name
  slug.value = val.slug
  fields.value = val.fields ?? []
  notifications.value = {
    enabled: val.notifications?.enabled ?? false,
    email: val.notifications?.email ?? '',
  }
}, { immediate: true })

watch(name, (v) => {
  if (isNew) slug.value = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
})

function addField(type: string) {
  const label = fieldTypes.find(f => f.type === type)?.label ?? type
  const field: FormField = { id: `field_${Date.now()}`, type, label, name: type + '_' + fields.value.length, required: false }
  if (OPTION_TYPES.includes(type)) field.options = []
  fields.value.push(field)
  selectedField.value = field
}

function removeField(id: string) {
  fields.value = fields.value.filter(f => f.id !== id)
  if (selectedField.value?.id === id) selectedField.value = null
}

function addOption(field: FormField) {
  if (!field.options) field.options = []
  field.options.push({ label: '', value: '' })
}

function removeOption(field: FormField, index: number) {
  field.options?.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    const body = {
      name: name.value,
      slug: slug.value,
      fields: fields.value,
      logic: [],
      notifications: {
        enabled: notifications.value.enabled,
        email: notifications.value.email || undefined,
      },
    }
    if (isNew) {
      const result = await $fetch<{ id: string }>('/api/v1/forms', { method: 'POST', body })
      await navigateTo(`/admin/forms/${result.id}/edit`)
    } else {
      await $fetch(`/api/v1/forms/${id}`, { method: 'PATCH', body })
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex gap-6 h-full">
    <!-- Field palette -->
    <aside class="w-52 shrink-0 space-y-1">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Add field</p>
      <button
        v-for="ft in fieldTypes"
        :key="ft.type"
        class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        @click="addField(ft.type)"
      >
        <UIcon :name="ft.icon" class="w-4 h-4 shrink-0" />
        {{ ft.label }}
      </button>
    </aside>

    <!-- Canvas -->
    <div class="flex-1 space-y-4">
      <div class="flex items-center justify-between">
        <UInput v-model="name" class="text-lg font-bold border-0 shadow-none" />
        <div class="flex gap-2">
          <UButton :to="`/admin/forms/${id}/submissions`" variant="outline" icon="i-lucide-inbox" size="sm">Submissions</UButton>
          <UButton :loading="saving" @click="save">Save form</UButton>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 min-h-96 p-4 space-y-3">
        <div
          v-for="field in fields"
          :key="field.id"
          class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
          :class="selectedField?.id === field.id
            ? 'border-primary-400 bg-primary-50 dark:bg-primary-950'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
          @click="selectedField = field"
        >
          <UIcon name="i-lucide-grip-vertical" class="w-4 h-4 text-gray-300 cursor-grab" />
          <div class="flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ field.label }}</p>
            <p class="text-xs text-gray-400">{{ field.type }}<span v-if="field.required" class="text-red-400 ml-1">*</span></p>
          </div>
          <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="error" @click.stop="removeField(field.id)" />
        </div>

        <div v-if="!fields.length" class="text-center py-12 text-gray-400">
          <UIcon name="i-lucide-list-plus" class="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">Click a field type on the left to add it</p>
        </div>
      </div>

      <!-- Form settings -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Submission notifications</p>
        <div class="flex items-center gap-3">
          <USwitch v-model="notifications.enabled" />
          <span class="text-sm text-gray-600 dark:text-gray-400">Email an admin when this form is submitted</span>
        </div>
        <UFormField v-if="notifications.enabled" label="Notify email (optional — defaults to the site's admin email)">
          <UInput v-model="notifications.email" size="sm" placeholder="admin@example.com" class="w-full max-w-sm" />
        </UFormField>
      </div>
    </div>

    <!-- Field settings panel -->
    <aside v-if="selectedField" class="w-64 shrink-0 space-y-3">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Field settings</p>
      <UFormField label="Label">
        <UInput v-model="selectedField.label" size="sm" />
      </UFormField>
      <UFormField label="Field name">
        <UInput v-model="selectedField.name" size="sm" />
      </UFormField>
      <UFormField label="Required">
        <USwitch v-model="selectedField.required" />
      </UFormField>

      <UFormField v-if="PLACEHOLDER_TYPES.includes(selectedField.type)" label="Placeholder">
        <UInput v-model="selectedField.placeholder" size="sm" />
      </UFormField>

      <div v-if="OPTION_TYPES.includes(selectedField.type)" class="space-y-2">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Options</p>
        <div v-for="(opt, index) in selectedField.options ?? []" :key="index" class="flex items-center gap-1">
          <UInput v-model="opt.label" size="sm" placeholder="Label" class="w-1/2" />
          <UInput v-model="opt.value" size="sm" placeholder="Value" class="w-1/2" />
          <UButton variant="ghost" size="xs" icon="i-lucide-x" color="error" @click="removeOption(selectedField, index)" />
        </div>
        <UButton variant="outline" size="xs" icon="i-lucide-plus" @click="addOption(selectedField)">Add option</UButton>
      </div>

      <UFormField v-if="selectedField.type === 'computed'" label="Formula" hint="Use {{fieldName}} to reference other fields">
        <UInput v-model="selectedField.formula" size="sm" placeholder="{{price}} * {{qty}}" />
      </UFormField>

      <UFormField v-if="selectedField.type === 'hidden'" label="Default value" hint="Used as this hidden field's fixed value">
        <UInput v-model="selectedField.placeholder" size="sm" />
      </UFormField>
    </aside>
  </div>
</template>
